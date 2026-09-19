-- Migration: 020 Make Outlet ID Nullable in Manual Adjustments and Ledger
PRAGMA foreign_keys = OFF;

-- 1. Recreate manual_adjustments table with nullable outlet_id
ALTER TABLE manual_adjustments RENAME TO old_manual_adjustments;

CREATE TABLE manual_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  outlet_id INTEGER, -- Nullable to support general salaries/expenses
  amount REAL NOT NULL,
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('deposit', 'withdrawal', 'credit_adjustment', 'debit_adjustment', 'expense', 'salary')),
  title TEXT,
  notes TEXT NOT NULL,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO manual_adjustments (id, outlet_id, amount, adjustment_type, title, notes, created_by, created_at)
SELECT id, outlet_id, amount, adjustment_type, title, notes, created_by, created_at
FROM old_manual_adjustments;

DROP TABLE old_manual_adjustments;

-- 2. Recreate finance_ledger_entries table with nullable outlet_id
ALTER TABLE finance_ledger_entries RENAME TO old_finance_ledger_entries;

CREATE TABLE finance_ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  outlet_id INTEGER, -- Nullable to support general salaries/expenses
  entry_type TEXT NOT NULL CHECK (entry_type IN ('invoice_created', 'invoice_cancelled', 'invoice_updated', 'payment_recorded', 'payment_supplied', 'payment_reversed', 'supply_reversed', 'return_created', 'manual_adjustment')),
  reference_type TEXT NOT NULL CHECK (reference_type IN ('invoice', 'payment', 'manual', 'return')),
  reference_id INTEGER,
  cash_amount REAL NOT NULL DEFAULT 0,
  receivable_amount REAL NOT NULL DEFAULT 0,
  notes TEXT,
  title TEXT,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO finance_ledger_entries (id, outlet_id, entry_type, reference_type, reference_id, cash_amount, receivable_amount, notes, title, created_by, created_at)
SELECT id, outlet_id, entry_type, reference_type, reference_id, cash_amount, receivable_amount, notes, title, created_by, created_at
FROM old_finance_ledger_entries;

DROP TABLE old_finance_ledger_entries;

PRAGMA foreign_keys = ON;
