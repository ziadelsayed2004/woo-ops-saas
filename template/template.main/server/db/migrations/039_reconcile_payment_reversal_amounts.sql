-- Complete the historical reconciliation for payment reversals that had no
-- movement values. Supplied reversals affect treasury; unsupplied reversals
-- affect collection custody.
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
  AND cash_amount = 0
  AND custody_amount = 0;
