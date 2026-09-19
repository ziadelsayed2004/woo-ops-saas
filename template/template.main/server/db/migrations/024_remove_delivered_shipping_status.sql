-- Collapse the obsolete delivered state into shipped and enforce the new state model.
UPDATE invoices SET shipping_status = 'shipped' WHERE shipping_status = 'delivered';
UPDATE shipments
SET status = 'shipped', shipped_at = COALESCE(shipped_at, delivered_at)
WHERE status = 'delivered';
UPDATE invoice_status_history SET old_status = 'shipped' WHERE status_type = 'shipping' AND old_status = 'delivered';
UPDATE invoice_status_history SET new_status = 'shipped' WHERE status_type = 'shipping' AND new_status = 'delivered';
UPDATE shipment_status_history SET old_status = 'shipped' WHERE old_status = 'delivered';
UPDATE shipment_status_history SET new_status = 'shipped' WHERE new_status = 'delivered';

CREATE TABLE invoices_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT UNIQUE NOT NULL,
  outlet_id INTEGER NOT NULL,
  subtotal REAL NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount REAL NOT NULL DEFAULT 0 CHECK (discount >= 0),
  shipping_cost REAL NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0),
  total_price REAL NOT NULL DEFAULT 0 CHECK (total_price >= 0),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partially_paid', 'paid', 'cancelled')),
  shipping_status TEXT NOT NULL DEFAULT 'pending' CHECK (shipping_status IN ('pending', 'partially_shipped', 'shipped')),
  payment_type TEXT NOT NULL DEFAULT 'cash' CHECK (payment_type IN ('cash', 'deferred')),
  notes TEXT,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (outlet_id) REFERENCES outlets(id),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO invoices_new (
  id, invoice_number, outlet_id, subtotal, discount, shipping_cost, total_price,
  payment_status, shipping_status, payment_type, notes, created_by, created_at, updated_at
)
SELECT
  id, invoice_number, outlet_id, subtotal, discount, shipping_cost, total_price,
  payment_status, shipping_status, payment_type, notes, created_by, created_at, updated_at
FROM invoices;
DROP TABLE invoices;
ALTER TABLE invoices_new RENAME TO invoices;

CREATE TABLE shipments_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_number TEXT UNIQUE NOT NULL,
  invoice_id INTEGER NOT NULL,
  shipping_carrier TEXT,
  tracking_number TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'shipped', 'cancelled')),
  shipped_at DATETIME,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO shipments_new (
  id, shipment_number, invoice_id, shipping_carrier, tracking_number, status,
  shipped_at, created_by, created_at, updated_at
)
SELECT
  id, shipment_number, invoice_id, shipping_carrier, tracking_number, status,
  shipped_at, created_by, created_at, updated_at
FROM shipments;
DROP TABLE shipments;
ALTER TABLE shipments_new RENAME TO shipments;

-- Grant the bulk shipping permission to the logistics role on existing databases.
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name = 'invoices.ship'
WHERE r.name = 'shipping_user';

DELETE FROM role_permissions
WHERE permission_id IN (SELECT id FROM permissions WHERE name = 'shipments.deliver');
DELETE FROM permissions WHERE name = 'shipments.deliver';
