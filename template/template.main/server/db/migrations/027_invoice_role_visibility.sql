INSERT OR IGNORE INTO permissions (name, description) VALUES
  ('invoices.archive.view', 'View archived invoices without changing archive state'),
  ('backup.view', 'View and download existing database backups');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE r.name = 'assistant' AND p.name = 'invoices.archive.view';

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE r.name = 'readonly_viewer' AND p.name IN ('invoices.archive.view', 'backup.view');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE r.name = 'outlet' AND p.name IN ('invoices.export', 'payments.view', 'payments.receipt.view');

DELETE FROM role_permissions
WHERE role_id = (SELECT id FROM roles WHERE name = 'assistant')
  AND permission_id IN (
    SELECT id FROM permissions WHERE name IN (
      'invoices.pay', 'payments.view', 'payments.create', 'payments.reverse',
      'payments.receipt.view', 'payments.receipt.upload',
      'payments.mark_supplied', 'payments.supply_batch',
      'finance.view', 'finance.adjust', 'finance.export', 'finance.statement.view'
    )
  );
