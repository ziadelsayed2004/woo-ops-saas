-- Inventory receipt lifecycle and supplier-return support.
ALTER TABLE inventory_receipts ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'partially_returned', 'returned', 'cancelled'));
ALTER TABLE inventory_receipts ADD COLUMN cancelled_at DATETIME;
ALTER TABLE inventory_receipts ADD COLUMN cancelled_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE inventory_receipts ADD COLUMN cancellation_reason TEXT;
-- SQLite cannot add a column with a non-constant default via ALTER TABLE.
ALTER TABLE inventory_receipts ADD COLUMN updated_at DATETIME;
UPDATE inventory_receipts SET updated_at = created_at WHERE updated_at IS NULL;

CREATE TABLE IF NOT EXISTS inventory_receipt_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_number TEXT UNIQUE NOT NULL,
  receipt_id INTEGER NOT NULL,
  return_date DATETIME NOT NULL,
  reason TEXT NOT NULL,
  notes TEXT,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (receipt_id) REFERENCES inventory_receipts(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS inventory_receipt_return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL,
  receipt_item_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  FOREIGN KEY (return_id) REFERENCES inventory_receipt_returns(id) ON DELETE CASCADE,
  FOREIGN KEY (receipt_item_id) REFERENCES inventory_receipt_items(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

-- Preserve the immutable ledger while allowing explicit compensating entries.
CREATE TABLE inventory_transactions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN (
    'receipt', 'sale', 'return', 'adjustment', 'supplier_return', 'receipt_cancellation'
  )),
  quantity INTEGER NOT NULL,
  reference_type TEXT NOT NULL CHECK (reference_type IN (
    'receipt', 'invoice', 'adjustment', 'receipt_return'
  )),
  reference_id INTEGER NOT NULL,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO inventory_transactions_new
  (id, product_id, transaction_type, quantity, reference_type, reference_id, created_by, created_at)
SELECT id, product_id, transaction_type, quantity, reference_type, reference_id, created_by, created_at
FROM inventory_transactions;

DROP TABLE inventory_transactions;
ALTER TABLE inventory_transactions_new RENAME TO inventory_transactions;

CREATE INDEX IF NOT EXISTS idx_inventory_receipt_returns_receipt
  ON inventory_receipt_returns(receipt_id);
CREATE INDEX IF NOT EXISTS idx_inventory_receipt_return_items_receipt_item
  ON inventory_receipt_return_items(receipt_item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_product_created
  ON inventory_transactions(product_id, created_at);

INSERT OR IGNORE INTO permissions (name, description)
VALUES ('inventory.receipts.reverse', 'Cancel inventory receipts or record supplier returns');
