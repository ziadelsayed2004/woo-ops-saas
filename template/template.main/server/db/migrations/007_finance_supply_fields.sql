-- Bookstore Manager Modernized - Add supplied_at and supplied_by to invoice_payments
ALTER TABLE invoice_payments ADD COLUMN supplied_at DATETIME;
ALTER TABLE invoice_payments ADD COLUMN supplied_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
