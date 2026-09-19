-- Repair legacy supply-reversal rows that were recorded with a zero treasury
-- amount before the custody/treasury split was introduced.
UPDATE finance_ledger_entries
SET cash_amount = -COALESCE((SELECT amount FROM invoice_payments WHERE id = reference_id), ABS(cash_amount)),
    custody_amount = COALESCE((SELECT amount FROM invoice_payments WHERE id = reference_id), ABS(cash_amount))
WHERE entry_type = 'supply_reversed'
  AND reference_type = 'payment'
  AND (cash_amount = 0 OR custody_amount = 0);

UPDATE finance_ledger_entries
SET cash_amount = CASE WHEN EXISTS (
      SELECT 1 FROM finance_ledger_entries supplied
      WHERE supplied.entry_type = 'payment_supplied'
        AND supplied.reference_type = 'payment'
        AND supplied.reference_id = finance_ledger_entries.reference_id
    ) THEN -COALESCE((SELECT amount FROM invoice_payments WHERE id = reference_id), ABS(cash_amount)) ELSE 0 END,
    custody_amount = CASE WHEN EXISTS (
      SELECT 1 FROM finance_ledger_entries supplied
      WHERE supplied.entry_type = 'payment_supplied'
        AND supplied.reference_type = 'payment'
        AND supplied.reference_id = finance_ledger_entries.reference_id
    ) THEN 0 ELSE -COALESCE((SELECT amount FROM invoice_payments WHERE id = reference_id), ABS(cash_amount)) END
WHERE entry_type = 'payment_reversed'
  AND reference_type = 'payment'
  AND (cash_amount = 0 AND custody_amount = 0);
