CREATE TABLE IF NOT EXISTS invoice_trash (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL UNIQUE,
  invoice_number TEXT NOT NULL UNIQUE,
  outlet_id INTEGER NOT NULL,
  total_price REAL NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL,
  shipping_status TEXT NOT NULL,
  was_archived INTEGER NOT NULL DEFAULT 0 CHECK (was_archived IN (0, 1)),
  original_created_at DATETIME,
  snapshot_version INTEGER NOT NULL DEFAULT 1,
  snapshot_json TEXT NOT NULL,
  trashed_by INTEGER,
  trashed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE RESTRICT,
  FOREIGN KEY (trashed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_invoice_trash_trashed_at ON invoice_trash (trashed_at);
CREATE INDEX IF NOT EXISTS idx_invoice_trash_outlet_id ON invoice_trash (outlet_id);

CREATE TABLE IF NOT EXISTS invoice_trash_products (
  trash_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  PRIMARY KEY (trash_id, product_id),
  FOREIGN KEY (trash_id) REFERENCES invoice_trash(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS invoice_trash_file_cleanup (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stored_path TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  queued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE finance_ledger_entries
ADD COLUMN invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE;

UPDATE finance_ledger_entries
SET invoice_id = reference_id
WHERE reference_type = 'invoice';

UPDATE finance_ledger_entries
SET invoice_id = (
  SELECT ip.invoice_id
  FROM invoice_payments ip
  WHERE ip.id = finance_ledger_entries.reference_id
)
WHERE reference_type = 'payment' AND invoice_id IS NULL;

UPDATE finance_ledger_entries
SET invoice_id = (
  SELECT r.invoice_id
  FROM returns r
  WHERE r.id = finance_ledger_entries.reference_id
)
WHERE reference_type = 'return' AND invoice_id IS NULL;

-- Reversed payments may no longer have an invoice_payments row. Recover their
-- invoice from the immutable invoice number written into the original ledger note.
UPDATE finance_ledger_entries AS target
SET invoice_id = (
  SELECT i.id
  FROM invoices i
  WHERE target.notes IS NOT NULL
    AND instr(target.notes, i.invoice_number) > 0
  ORDER BY length(i.invoice_number) DESC
  LIMIT 1
)
WHERE target.reference_type = 'payment' AND target.invoice_id IS NULL;

-- Supply/reversal rows share the deleted payment reference ID, so inherit the
-- association recovered on any sibling ledger row.
UPDATE finance_ledger_entries AS target
SET invoice_id = (
  SELECT sibling.invoice_id
  FROM finance_ledger_entries sibling
  WHERE sibling.reference_type = 'payment'
    AND sibling.reference_id = target.reference_id
    AND sibling.invoice_id IS NOT NULL
  LIMIT 1
)
WHERE target.reference_type = 'payment' AND target.invoice_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_finance_ledger_invoice_id
ON finance_ledger_entries (invoice_id);

INSERT OR IGNORE INTO permissions (name, description)
VALUES ('invoices.trash', 'Move, restore, and permanently delete invoices through the owner-only trash');

DELETE FROM role_permissions
WHERE permission_id = (SELECT id FROM permissions WHERE name = 'invoices.trash')
  AND role_id NOT IN (SELECT id FROM roles WHERE name = 'super_admin');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name = 'invoices.trash'
WHERE r.name = 'super_admin';
