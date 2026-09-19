-- Migration: Add payment_methods table for dynamic payment method management
-- and add e_wallet as a new payment method

-- 1. Create payment_methods table
CREATE TABLE IF NOT EXISTS payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  label_ar TEXT NOT NULL,
  label_en TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Seed default payment methods
INSERT OR IGNORE INTO payment_methods (key, label_ar, label_en, is_active, sort_order) VALUES
  ('cash', 'نقدي', 'Cash', 1, 1),
  ('check', 'شيك', 'Check', 1, 2),
  ('bank_transfer', 'تحويل بنكي', 'Bank Transfer', 1, 3),
  ('e_wallet', 'محفظة إلكترونية', 'E-Wallet', 1, 4);

-- 3. Recreate invoice_payments without the CHECK constraint on payment_method
--    so that dynamic payment methods can be used.

-- 3a. Create new table without the payment_method CHECK constraint
CREATE TABLE invoice_payments_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL,
  payment_date DATETIME NOT NULL,
  reference_number TEXT,
  notes TEXT,
  recorded_by INTEGER,
  supply_status TEXT NOT NULL DEFAULT 'not_supplied' CHECK (supply_status IN ('supplied', 'not_supplied')),
  supplied_at DATETIME,
  supplied_by INTEGER,
  receipt_original_name TEXT,
  receipt_stored_path TEXT,
  receipt_mime_type TEXT,
  receipt_size INTEGER,
  receipt_status TEXT NOT NULL DEFAULT 'approved' CHECK (receipt_status IN ('approved', 'pending_review', 'rejected')),
  receipt_reviewer_id INTEGER,
  receipt_reviewed_at DATETIME,
  receipt_review_note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE SET NULL
);

-- 3b. Copy data from old table
INSERT INTO invoice_payments_new (
  id, invoice_id, amount, payment_method, payment_date, reference_number, notes,
  recorded_by, supply_status, supplied_at, supplied_by,
  receipt_original_name, receipt_stored_path, receipt_mime_type, receipt_size,
  receipt_status, receipt_reviewer_id, receipt_reviewed_at, receipt_review_note,
  created_at
)
SELECT
  id, invoice_id, amount, payment_method, payment_date, reference_number, notes,
  recorded_by, supply_status, supplied_at, supplied_by,
  receipt_original_name, receipt_stored_path, receipt_mime_type, receipt_size,
  receipt_status, receipt_reviewer_id, receipt_reviewed_at, receipt_review_note,
  created_at
FROM invoice_payments;

-- 3c. Drop old table
DROP TABLE invoice_payments;

-- 3d. Rename new table to original name
ALTER TABLE invoice_payments_new RENAME TO invoice_payments;

-- 4. Add admin permission for managing payment methods
INSERT OR IGNORE INTO permissions (name, description) VALUES
  ('payments.methods.manage', 'إدارة طرق الدفع (إضافة/تعديل/حذف/تفعيل/تعطيل)');

-- Grant to super_admin
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r, permissions p
  WHERE r.name = 'super_admin' AND p.name = 'payments.methods.manage';

-- Grant to assistant
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r, permissions p
  WHERE r.name = 'assistant' AND p.name = 'payments.methods.manage';
