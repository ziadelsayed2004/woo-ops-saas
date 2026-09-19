-- Bookstore Manager Modernized - Notifications Category Check Migration

-- 1. Rename existing notifications table to temporary
ALTER TABLE notifications RENAME TO notifications_old;

-- 2. Create the new notifications table with expanded categories in check constraint
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL CHECK (category IN (
    'stock_negative', 'stock_low', 'outlet_credit_limit_exceeded',
    'invoice_overdue', 'installment_due', 'payment_received',
    'shipment_partial', 'shipment_delayed', 'system', 'finance_warning', 'price_missing'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical', 'success')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  source_type TEXT,
  source_id INTEGER,
  dedupe_key TEXT,
  status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'resolved')),
  action_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME
);

-- 3. Copy data from old table to new table
INSERT INTO notifications (
  id, category, severity, title, message, source_type, source_id,
  dedupe_key, status, action_url, created_at, updated_at, resolved_at
)
SELECT 
  id, category, severity, title, message, source_type, source_id,
  dedupe_key, status, action_url, created_at, updated_at, resolved_at
FROM notifications_old;

-- 4. Recreate the index
DROP INDEX IF EXISTS idx_notifications_active_dedupe;
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_active_dedupe 
ON notifications(dedupe_key) 
WHERE status IN ('unread', 'read');

-- 5. Drop old table
DROP TABLE notifications_old;
