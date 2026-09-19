-- Separate company treasury movements from collection custody movements and
-- make payment/supply history reversible without deleting source records.
ALTER TABLE finance_ledger_entries ADD COLUMN custody_amount REAL NOT NULL DEFAULT 0;

ALTER TABLE invoice_payments ADD COLUMN reversed_at DATETIME;
ALTER TABLE invoice_payments ADD COLUMN reversed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE invoice_payments ADD COLUMN reversal_notes TEXT;

ALTER TABLE payment_supply_batches ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'partially_reversed', 'reversed'));
ALTER TABLE payment_supply_batches ADD COLUMN selection_mode TEXT NOT NULL DEFAULT 'manual'
  CHECK (selection_mode IN ('manual', 'lower', 'upper', 'legacy'));
ALTER TABLE payment_supply_batches ADD COLUMN reversed_at DATETIME;
ALTER TABLE payment_supply_batches ADD COLUMN reversed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE payment_supply_batches ADD COLUMN reversal_notes TEXT;
ALTER TABLE payment_supply_batches ADD COLUMN is_legacy INTEGER NOT NULL DEFAULT 0 CHECK (is_legacy IN (0, 1));
ALTER TABLE payment_supply_batches ADD COLUMN legacy_payment_id INTEGER;

ALTER TABLE payment_supply_batch_items ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'reversed'));
ALTER TABLE payment_supply_batch_items ADD COLUMN reversed_at DATETIME;
ALTER TABLE payment_supply_batch_items ADD COLUMN reversed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE payment_supply_batch_items ADD COLUMN reversal_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_finance_ledger_custody ON finance_ledger_entries (entry_type, created_at);
CREATE INDEX IF NOT EXISTS idx_supply_batches_status ON payment_supply_batches (status, created_at);
CREATE INDEX IF NOT EXISTS idx_supply_items_payment ON payment_supply_batch_items (payment_id, status);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_active ON invoice_payments (supply_status, receipt_status, reversed_at);

CREATE TABLE IF NOT EXISTS finance_migration_anomalies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  migration_name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  details TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME
);

-- Payment-method administration is owner-only. The assistant must never gain
-- this capability through the legacy 035 grant.
DELETE FROM role_permissions
WHERE role_id = (SELECT id FROM roles WHERE name = 'assistant')
  AND permission_id = (SELECT id FROM permissions WHERE name = 'payments.methods.manage');

-- The collection operator can record and view payments, but cannot reverse
-- them or perform any treasury/supply operation.
DELETE FROM role_permissions
WHERE role_id = (SELECT id FROM roles WHERE name = 'invoice_payment_operator')
  AND permission_id IN (
    SELECT id FROM permissions
    WHERE name IN ('payments.reverse', 'payments.mark_supplied', 'payments.supply_batch', 'payments.supply.amount', 'payments.supply.reverse')
  );

-- Normalize historical payment movements. A payment collection is custody
-- until its supply event; the supply event is the company-treasury movement.
UPDATE finance_ledger_entries
SET cash_amount = 0,
    custody_amount = COALESCE((SELECT amount FROM invoice_payments WHERE id = reference_id), 0)
WHERE entry_type = 'payment_recorded' AND reference_type = 'payment';

UPDATE finance_ledger_entries
SET cash_amount = COALESCE((SELECT amount FROM invoice_payments WHERE id = reference_id), 0),
    custody_amount = -COALESCE((SELECT amount FROM invoice_payments WHERE id = reference_id), 0)
WHERE entry_type = 'payment_supplied' AND reference_type = 'payment';

UPDATE finance_ledger_entries
SET cash_amount = -COALESCE((SELECT amount FROM invoice_payments WHERE id = reference_id), ABS(cash_amount)),
    custody_amount = COALESCE((SELECT amount FROM invoice_payments WHERE id = reference_id), ABS(cash_amount))
WHERE entry_type = 'supply_reversed' AND reference_type = 'payment';

UPDATE finance_ledger_entries
SET cash_amount = CASE WHEN EXISTS (
      SELECT 1 FROM finance_ledger_entries supplied
      WHERE supplied.entry_type = 'payment_supplied'
        AND supplied.reference_type = 'payment'
        AND supplied.reference_id = finance_ledger_entries.reference_id
    ) THEN -ABS(cash_amount) ELSE 0 END,
    custody_amount = CASE WHEN EXISTS (
      SELECT 1 FROM finance_ledger_entries supplied
      WHERE supplied.entry_type = 'payment_supplied'
        AND supplied.reference_type = 'payment'
        AND supplied.reference_id = finance_ledger_entries.reference_id
    ) THEN 0 ELSE -ABS(cash_amount) END
WHERE entry_type = 'payment_reversed' AND reference_type = 'payment';

-- Reconstruct a one-payment legacy supply batch when old data has a supplied
-- flag but no batch item. The legacy marker makes this visible and auditable.
INSERT INTO payment_supply_batches
  (requested_amount, supplied_amount, outlet_id, created_by, created_at,
   selection_mode, is_legacy, legacy_payment_id)
SELECT p.amount, p.amount, i.outlet_id, p.supplied_by,
       COALESCE(p.supplied_at, p.payment_date, CURRENT_TIMESTAMP),
       'legacy', 1, p.id
FROM invoice_payments p
JOIN invoices i ON i.id = p.invoice_id
WHERE p.supply_status = 'supplied'
  AND NOT EXISTS (
    SELECT 1 FROM payment_supply_batch_items bi WHERE bi.payment_id = p.id
  );

INSERT INTO payment_supply_batch_items (batch_id, payment_id, amount)
SELECT b.id, b.legacy_payment_id, b.supplied_amount
FROM payment_supply_batches b
WHERE b.is_legacy = 1
  AND b.legacy_payment_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM payment_supply_batch_items bi
    WHERE bi.batch_id = b.id AND bi.payment_id = b.legacy_payment_id
  );

-- Ensure every historical supplied item has a non-zero treasury/custody
-- movement even if the old application inserted a zero-valued ledger row.
INSERT INTO finance_ledger_entries
  (outlet_id, invoice_id, entry_type, reference_type, reference_id,
   cash_amount, custody_amount, receivable_amount, notes, created_by, created_at)
SELECT i.outlet_id, p.invoice_id, 'payment_supplied', 'payment', p.id,
       p.amount, -p.amount, 0, 'Legacy payment supply reconstructed.', b.created_by,
       COALESCE(b.created_at, CURRENT_TIMESTAMP)
FROM payment_supply_batch_items bi
JOIN payment_supply_batches b ON b.id = bi.batch_id
JOIN invoice_payments p ON p.id = bi.payment_id
JOIN invoices i ON i.id = p.invoice_id
WHERE bi.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM finance_ledger_entries fle
    WHERE fle.entry_type = 'payment_supplied'
      AND fle.reference_type = 'payment'
      AND fle.reference_id = p.id
  );

INSERT INTO finance_migration_anomalies (migration_name, entity_type, entity_id, details)
SELECT '036_treasury_custody_and_supply_audit.sql', 'ledger_entry', fle.id,
       'Payment supply history references a payment row that no longer exists.'
FROM finance_ledger_entries fle
WHERE fle.entry_type IN ('payment_supplied', 'supply_reversed')
  AND fle.reference_type = 'payment'
  AND NOT EXISTS (SELECT 1 FROM invoice_payments p WHERE p.id = fle.reference_id);
