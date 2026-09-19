const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

jest.mock('../../../db', () => {
  let database;
  return {
    setDatabase: value => { database = value; },
    run: (sql, params = []) => new Promise((resolve, reject) => {
      database.run(sql, params, function callback(error) {
        if (error) reject(error);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    }),
    get: (sql, params = []) => new Promise((resolve, reject) => {
      database.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
    }),
    all: (sql, params = []) => new Promise((resolve, reject) => {
      database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
    }),
    exec: sql => new Promise((resolve, reject) => {
      database.exec(sql, error => error ? reject(error) : resolve());
    })
  };
});

jest.mock('../../notifications/notificationsService', () => ({
  checkOutletCreditLimitNotifications: jest.fn().mockResolvedValue(),
  checkOutletFinanceNotifications: jest.fn().mockResolvedValue(),
  checkStockNotifications: jest.fn().mockResolvedValue()
}));

jest.mock('../../../config', () => {
  const mockPath = require('path');
  const mockOs = require('os');
  return { uploadsDir: mockPath.join(mockOs.tmpdir(), 'invoice-trash-service-tests') };
});

const db = require('../../../db');
const config = require('../../../config');
const service = require('../invoiceTrashService');

const openDb = () => new Promise((resolve, reject) => {
  const database = new sqlite3.Database(':memory:', error => error ? reject(error) : resolve(database));
});
const closeDb = database => new Promise((resolve, reject) => database.close(error => error ? reject(error) : resolve()));

async function createSchema() {
  await db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT);
    CREATE TABLE outlets (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE products (id INTEGER PRIMARY KEY, title TEXT);
    CREATE TABLE roles (id INTEGER PRIMARY KEY, name TEXT UNIQUE);
    CREATE TABLE permissions (id INTEGER PRIMARY KEY, name TEXT UNIQUE, description TEXT);
    CREATE TABLE role_permissions (role_id INTEGER, permission_id INTEGER, UNIQUE(role_id, permission_id));
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT, target_type TEXT,
      target_id TEXT, details TEXT, ip_address TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_number TEXT UNIQUE, outlet_id INTEGER,
      total_price REAL, payment_status TEXT, shipping_status TEXT, payment_type TEXT,
      archived_at DATETIME, created_at DATETIME
    );
    CREATE TABLE invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER, product_id INTEGER, quantity INTEGER,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    );
    CREATE TABLE invoice_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER, status_type TEXT,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    );
    CREATE TABLE invoice_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER, amount REAL, supply_status TEXT,
      receipt_stored_path TEXT, FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    );
    CREATE TABLE shipments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER, status TEXT,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    );
    CREATE TABLE shipment_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, shipment_id INTEGER, invoice_item_id INTEGER, quantity INTEGER,
      FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE
    );
    CREATE TABLE shipment_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, shipment_id INTEGER, old_status TEXT, new_status TEXT,
      FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE
    );
    CREATE TABLE returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER, outlet_id INTEGER, return_value REAL, status TEXT
    );
    CREATE TABLE return_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, return_id INTEGER, invoice_item_id INTEGER, product_id INTEGER, quantity INTEGER,
      FOREIGN KEY (return_id) REFERENCES returns(id) ON DELETE CASCADE
    );
    CREATE TABLE inventory_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, transaction_type TEXT,
      quantity INTEGER, reference_type TEXT, reference_id INTEGER
    );
    CREATE TABLE finance_ledger_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, outlet_id INTEGER, entry_type TEXT,
      reference_type TEXT, reference_id INTEGER, cash_amount REAL, receivable_amount REAL, notes TEXT
    );
    CREATE TABLE notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT, severity TEXT, title TEXT, message TEXT,
      source_type TEXT, source_id INTEGER, dedupe_key TEXT UNIQUE, status TEXT, action_url TEXT
    );
    INSERT INTO users VALUES (1, 'Owner');
    INSERT INTO outlets VALUES (2, 'Outlet');
    INSERT INTO products VALUES (3, 'Book');
    INSERT INTO roles VALUES (1, 'super_admin'), (2, 'assistant');
  `);
  const migration = fs.readFileSync(path.join(__dirname, '../../../db/migrations/029_invoice_trash.sql'), 'utf8');
  await db.exec(migration);
}

async function seedInvoice(receiptPath = null, invoiceId = 10) {
  await db.run(
    `INSERT INTO invoices VALUES (?, ?, 2, 100, 'partially_paid', 'shipped', 'deferred', '2026-01-15', '2026-01-01')`,
    [invoiceId, `INV-${invoiceId}`]
  );
  await db.run('INSERT INTO invoice_items VALUES (?, ?, 3, 5)', [invoiceId + 10, invoiceId]);
  await db.run("INSERT INTO invoice_status_history VALUES (?, ?, 'payment')", [invoiceId + 11, invoiceId]);
  await db.run("INSERT INTO invoice_payments VALUES (?, ?, 40, 'supplied', ?)", [invoiceId + 20, invoiceId, receiptPath]);
  await db.run("INSERT INTO shipments VALUES (?, ?, 'shipped')", [invoiceId + 30, invoiceId]);
  await db.run('INSERT INTO shipment_items VALUES (?, ?, ?, 5)', [invoiceId + 31, invoiceId + 30, invoiceId + 10]);
  await db.run("INSERT INTO shipment_status_history VALUES (?, ?, 'pending', 'shipped')", [invoiceId + 32, invoiceId + 30]);
  await db.run("INSERT INTO returns VALUES (?, ?, 2, 10, 'approved')", [invoiceId + 40, invoiceId]);
  await db.run('INSERT INTO return_items VALUES (?, ?, ?, 3, 1)', [invoiceId + 41, invoiceId + 40, invoiceId + 10]);
  await db.run("INSERT INTO inventory_transactions VALUES (?, 3, 'sale', -5, 'invoice', ?)", [invoiceId + 50, invoiceId]);
  await db.run("INSERT INTO inventory_transactions VALUES (?, 3, 'return', 1, 'invoice', ?)", [invoiceId + 51, invoiceId]);
  await db.run(
    "INSERT INTO finance_ledger_entries (id, outlet_id, entry_type, reference_type, reference_id, cash_amount, receivable_amount, invoice_id) VALUES (?, 2, 'invoice_created', 'invoice', ?, 0, 100, ?)",
    [invoiceId + 60, invoiceId, invoiceId]
  );
  await db.run(
    "INSERT INTO finance_ledger_entries (id, outlet_id, entry_type, reference_type, reference_id, cash_amount, receivable_amount, invoice_id) VALUES (?, 2, 'payment_recorded', 'payment', ?, 40, -40, ?)",
    [invoiceId + 61, invoiceId + 20, invoiceId]
  );
  await db.run(
    "INSERT INTO finance_ledger_entries (id, outlet_id, entry_type, reference_type, reference_id, cash_amount, receivable_amount, invoice_id) VALUES (?, 2, 'return_created', 'return', ?, 0, -10, ?)",
    [invoiceId + 62, invoiceId + 40, invoiceId]
  );
  await db.run(
    "INSERT INTO finance_ledger_entries (id, outlet_id, entry_type, reference_type, reference_id, cash_amount, receivable_amount, invoice_id) VALUES (?, 2, 'payment_reversed', 'payment', 999999, -5, 5, ?)",
    [invoiceId + 63, invoiceId]
  );
  await db.run("INSERT INTO notifications VALUES (?, 'system', 'info', 'Invoice', 'Invoice event', 'invoice', ?, ?, 'unread', '/invoices')", [invoiceId + 70, invoiceId, `invoice:${invoiceId}`]);
}

describe('invoiceTrashService integration', () => {
  let database;

  beforeEach(async () => {
    database = await openDb();
    db.setDatabase(database);
    fs.rmSync(config.uploadsDir, { recursive: true, force: true });
    fs.mkdirSync(config.uploadsDir, { recursive: true });
    await createSchema();
  });

  afterEach(async () => {
    await closeDb(database);
    fs.rmSync(config.uploadsDir, { recursive: true, force: true });
  });

  test('removes every operational and accounting effect, then restores the exact invoice graph', async () => {
    const receiptPath = path.join(config.uploadsDir, 'receipt.pdf');
    fs.writeFileSync(receiptPath, 'receipt');
    await seedInvoice(receiptPath);

    const beforeLedger = await db.get('SELECT SUM(cash_amount) cash, SUM(receivable_amount) receivable FROM finance_ledger_entries');
    const beforeStock = await db.get('SELECT SUM(quantity) quantity FROM inventory_transactions');

    await service.trashInvoices({ invoiceIds: [10], userId: 1 });

    expect(await db.get('SELECT COUNT(*) count FROM invoices')).toEqual({ count: 0 });
    expect(await db.get('SELECT COUNT(*) count FROM finance_ledger_entries')).toEqual({ count: 0 });
    expect(await db.get('SELECT COUNT(*) count FROM inventory_transactions')).toEqual({ count: 0 });
    expect(await db.get('SELECT COUNT(*) count FROM invoice_trash')).toEqual({ count: 1 });
    expect(fs.existsSync(receiptPath)).toBe(true);

    await service.restoreTrashedInvoices({ invoiceIds: [10], userId: 1 });

    expect(await db.get('SELECT invoice_number, archived_at FROM invoices WHERE id = 10')).toEqual({
      invoice_number: 'INV-10',
      archived_at: '2026-01-15'
    });
    expect(await db.get('SELECT SUM(cash_amount) cash, SUM(receivable_amount) receivable FROM finance_ledger_entries')).toEqual(beforeLedger);
    expect(await db.get('SELECT SUM(quantity) quantity FROM inventory_transactions')).toEqual(beforeStock);
    expect(await db.get('SELECT COUNT(*) count FROM invoice_items')).toEqual({ count: 1 });
    expect(await db.get('SELECT COUNT(*) count FROM invoice_payments')).toEqual({ count: 1 });
    expect(await db.get('SELECT COUNT(*) count FROM shipments')).toEqual({ count: 1 });
    expect(await db.get('SELECT COUNT(*) count FROM returns')).toEqual({ count: 1 });
    expect(await db.get('SELECT COUNT(*) count FROM notifications')).toEqual({ count: 1 });
    expect(await db.get('SELECT COUNT(*) count FROM invoice_trash')).toEqual({ count: 0 });
  });

  test('rolls back the complete selection when one invoice does not exist', async () => {
    await seedInvoice();
    await expect(service.trashInvoices({ invoiceIds: [10, 999], userId: 1 }))
      .rejects.toMatchObject({ status: 404 });
    expect(await db.get('SELECT COUNT(*) count FROM invoices')).toEqual({ count: 1 });
    expect(await db.get('SELECT COUNT(*) count FROM invoice_trash')).toEqual({ count: 0 });
  });

  test('permanent deletion removes the snapshot and queued receipt file', async () => {
    const receiptPath = path.join(config.uploadsDir, 'receipt.pdf');
    fs.writeFileSync(receiptPath, 'receipt');
    await seedInvoice(receiptPath);
    await service.trashInvoices({ invoiceIds: [10], userId: 1 });

    await service.permanentlyDeleteTrashedInvoices({ invoiceIds: [10], userId: 1 });

    expect(await db.get('SELECT COUNT(*) count FROM invoice_trash')).toEqual({ count: 0 });
    expect(await db.get('SELECT COUNT(*) count FROM invoice_trash_file_cleanup')).toEqual({ count: 0 });
    expect(fs.existsSync(receiptPath)).toBe(false);
  });

  test('automatically purges only invoices that reached the retention threshold', async () => {
    await seedInvoice(null, 10);
    await seedInvoice(null, 100);
    await service.trashInvoices({ invoiceIds: [10, 100], userId: 1 });
    await db.run("UPDATE invoice_trash SET trashed_at = datetime('now', '-31 days') WHERE invoice_id = 10");
    await db.run("UPDATE invoice_trash SET trashed_at = datetime('now', '-29 days') WHERE invoice_id = 100");

    const result = await service.purgeExpiredTrash();

    expect(result).toEqual({ deleted: 1, failed: 0 });
    expect(await db.get('SELECT invoice_id FROM invoice_trash')).toEqual({ invoice_id: 100 });
  });
});
