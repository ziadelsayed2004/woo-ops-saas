-- Bookstore Manager Modernized - Notifications Schema

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL CHECK (category IN (
    'stock_negative', 'stock_low', 'outlet_credit_limit_exceeded',
    'invoice_overdue', 'installment_due', 'payment_received',
    'shipment_partial', 'shipment_delayed', 'system'
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

-- Unique index for active notifications to support deduplication
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_active_dedupe 
ON notifications(dedupe_key) 
WHERE status IN ('unread', 'read');
