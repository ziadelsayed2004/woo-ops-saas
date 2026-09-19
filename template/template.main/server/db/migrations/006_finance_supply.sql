-- Bookstore Manager Modernized - Payments Supply and Ledger check constraint
PRAGMA foreign_keys = OFF;

ALTER TABLE invoice_payments ADD COLUMN supply_status TEXT DEFAULT 'not_supplied' CHECK (supply_status IN ('not_supplied', 'supplied'));

ALTER TABLE finance_ledger_entries RENAME TO _finance_ledger_entries_old;

CREATE TABLE finance_ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  outlet_id INTEGER NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('invoice_created', 'invoice_cancelled', 'invoice_updated', 'payment_recorded', 'payment_reversed', 'manual_adjustment', 'payment_supplied', 'supply_reversed')),
  reference_type TEXT NOT NULL CHECK (reference_type IN ('invoice', 'payment', 'manual')),
  reference_id INTEGER,
  cash_amount REAL NOT NULL DEFAULT 0,
  receivable_amount REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO finance_ledger_entries (id, outlet_id, entry_type, reference_type, reference_id, cash_amount, receivable_amount, notes, created_by, created_at)
SELECT id, outlet_id, entry_type, reference_type, reference_id, cash_amount, receivable_amount, notes, created_by, created_at
FROM _finance_ledger_entries_old;

DROP TABLE _finance_ledger_entries_old;

PRAGMA foreign_keys = ON;
