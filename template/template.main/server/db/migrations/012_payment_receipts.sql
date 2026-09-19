-- Bookstore Manager Modernized - Payment Receipts Schema

-- Add receipt-related columns to invoice_payments table
ALTER TABLE invoice_payments ADD COLUMN receipt_original_name TEXT;
ALTER TABLE invoice_payments ADD COLUMN receipt_stored_path TEXT;
ALTER TABLE invoice_payments ADD COLUMN receipt_mime_type TEXT;
ALTER TABLE invoice_payments ADD COLUMN receipt_size INTEGER;
ALTER TABLE invoice_payments ADD COLUMN receipt_status TEXT CHECK (receipt_status IN ('pending_review', 'approved', 'rejected')) DEFAULT 'approved';
ALTER TABLE invoice_payments ADD COLUMN receipt_reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE invoice_payments ADD COLUMN receipt_reviewed_at DATETIME;
ALTER TABLE invoice_payments ADD COLUMN receipt_review_note TEXT;
