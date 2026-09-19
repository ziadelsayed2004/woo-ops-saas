-- Migration: 019 Add Title and New Types to Manual Adjustments

PRAGMA foreign_keys = OFF;

-- 1. Rename existing table
ALTER TABLE manual_adjustments RENAME TO old_manual_adjustments;

-- 2. Create new table with updated constraints and title column
CREATE TABLE manual_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  outlet_id INTEGER NOT NULL,
  amount REAL NOT NULL, -- positive for deposit/debit_adj, negative for withdrawal/credit_adj/expense/salary
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('deposit', 'withdrawal', 'credit_adjustment', 'debit_adjustment', 'expense', 'salary')),
  title TEXT,
  notes TEXT NOT NULL,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- 3. Copy existing data
INSERT INTO manual_adjustments (id, outlet_id, amount, adjustment_type, title, notes, created_by, created_at)
SELECT id, outlet_id, amount, adjustment_type, NULL, notes, created_by, created_at
FROM old_manual_adjustments;

-- 4. Drop old table
DROP TABLE old_manual_adjustments;

-- 5. Add title column to finance_ledger_entries
ALTER TABLE finance_ledger_entries ADD COLUMN title TEXT;

PRAGMA foreign_keys = ON;
