-- Add a fixed collection-only capability role. It is intentionally separate
-- from the assistant baseline so existing assistant accounts remain unchanged.
INSERT OR IGNORE INTO permissions (name, description) VALUES
  ('payments.receipt.review', 'Approve or reject uploaded payment receipts'),
  ('payments.supply.reverse', 'Reverse a payment supply operation');

INSERT OR IGNORE INTO roles
  (name, description, is_system, is_assignable, is_active)
VALUES
  ('invoice_payment_operator',
   'Invoice collection operator; must be assigned with the assistant role',
   1, 1, 1);

UPDATE roles
SET description = 'Invoice collection operator; must be assigned with the assistant role',
    is_system = 1,
    is_assignable = 1,
    is_active = 1,
    updated_at = CURRENT_TIMESTAMP
WHERE name = 'invoice_payment_operator';

DELETE FROM role_permissions
WHERE role_id = (SELECT id FROM roles WHERE name = 'invoice_payment_operator');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'invoice_payment_operator'
  AND p.name IN (
    'invoices.pay',
    'payments.view',
    'payments.create',
    'payments.reverse',
    'payments.receipt.view',
    'payments.receipt.upload'
  );

-- The owner keeps every capability, including the newly separated actions.
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'super_admin';

