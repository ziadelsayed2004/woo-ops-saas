-- Bookstore Manager Modernized - Finance Ledger Schema

CREATE TABLE IF NOT EXISTS finance_ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  outlet_id INTEGER NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('invoice_created', 'invoice_cancelled', 'invoice_updated', 'payment_recorded', 'payment_supplied', 'payment_reversed', 'return_created', 'manual_adjustment')),
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

CREATE TABLE IF NOT EXISTS manual_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  outlet_id INTEGER NOT NULL,
  amount REAL NOT NULL, -- positive for deposit/debit_adj, negative for withdrawal/credit_adj
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('deposit', 'withdrawal', 'credit_adjustment', 'debit_adjustment')),
  notes TEXT NOT NULL,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
