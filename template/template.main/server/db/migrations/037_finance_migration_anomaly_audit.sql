CREATE TABLE IF NOT EXISTS finance_migration_anomalies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  migration_name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  details TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME
);

INSERT INTO finance_migration_anomalies (migration_name, entity_type, entity_id, details)
SELECT '037_finance_migration_anomaly_audit.sql', 'ledger_entry', fle.id,
       'Payment supply history references a payment row that no longer exists.'
FROM finance_ledger_entries fle
WHERE fle.entry_type IN ('payment_supplied', 'supply_reversed')
  AND fle.reference_type = 'payment'
  AND NOT EXISTS (SELECT 1 FROM invoice_payments p WHERE p.id = fle.reference_id)
  AND NOT EXISTS (
    SELECT 1 FROM finance_migration_anomalies a
    WHERE a.entity_type = 'ledger_entry' AND a.entity_id = fle.id
  );

