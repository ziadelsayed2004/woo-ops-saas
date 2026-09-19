CREATE TABLE IF NOT EXISTS payment_supply_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requested_amount REAL NOT NULL CHECK (requested_amount > 0),
  supplied_amount REAL NOT NULL CHECK (supplied_amount > 0),
  outlet_id INTEGER,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS payment_supply_batch_items (
  batch_id INTEGER NOT NULL,
  payment_id INTEGER NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  PRIMARY KEY (batch_id, payment_id),
  FOREIGN KEY (batch_id) REFERENCES payment_supply_batches(id) ON DELETE CASCADE,
  FOREIGN KEY (payment_id) REFERENCES invoice_payments(id) ON DELETE RESTRICT
);

INSERT OR IGNORE INTO permissions (name, description)
VALUES ('payments.supply.amount', 'Supply a selected amount of eligible payments');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'super_admin' AND p.name = 'payments.supply.amount';
