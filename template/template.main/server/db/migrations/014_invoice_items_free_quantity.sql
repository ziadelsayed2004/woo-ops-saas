-- Migration 014: Add free_quantity to invoice_items
ALTER TABLE invoice_items ADD COLUMN free_quantity INTEGER NOT NULL DEFAULT 0;
