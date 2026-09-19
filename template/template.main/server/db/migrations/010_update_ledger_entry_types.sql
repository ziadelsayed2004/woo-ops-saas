-- Migration: 010 Update Ledger Entry Types check constraint

-- Disable foreign keys temporarily to prevent constraint violation issues during table recreation
PRAGMA foreign_keys = OFF;

-- 1. Rename existing table
ALTER TABLE finance_ledger_entries RENAME TO old_finance_ledger_entries;

-- 2. Create new table with updated constraints
CREATE TABLE finance_ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  outlet_id INTEGER NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('invoice_created', 'invoice_cancelled', 'invoice_updated', 'payment_recorded', 'payment_supplied', 'payment_reversed', 'supply_reversed', 'return_created', 'manual_adjustment')),
  reference_type TEXT NOT NULL CHECK (reference_type IN ('invoice', 'payment', 'manual', 'return')),
  reference_id INTEGER,
  cash_amount REAL NOT NULL DEFAULT 0,
  receivable_amount REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- 3. Copy existing data
INSERT INTO finance_ledger_entries (id, outlet_id, entry_type, reference_type, reference_id, cash_amount, receivable_amount, notes, created_by, created_at)
SELECT id, outlet_id, entry_type, reference_type, reference_id, cash_amount, receivable_amount, notes, created_by, created_at
FROM old_finance_ledger_entries;

-- 4. Drop old table
DROP TABLE old_finance_ledger_entries;

-- Re-enable foreign keys
PRAGMA foreign_keys = ON;
