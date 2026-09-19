-- Add granular master-data permissions so administrative-assistant access can
-- be enabled or disabled per operation.
INSERT OR IGNORE INTO permissions (name, description) VALUES
  ('authors.delete', 'Delete authors that are not linked to books'),
  ('categories.view', 'View book categories'),
  ('categories.create', 'Create book categories'),
  ('categories.update', 'Update book categories'),
  ('categories.delete', 'Delete book categories that are not linked to books'),
  ('outlet_types.create', 'Create outlet categories'),
  ('outlet_types.update', 'Update outlet categories'),
  ('outlet_types.delete', 'Delete outlet categories that are not linked to outlets'),
  ('outlets.delete', 'Delete outlets that have no invoices');

-- Preserve the effective access of every existing role while splitting
-- permissions that previously covered more than one resource or operation.
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, target.id
FROM role_permissions rp
JOIN permissions source ON source.id = rp.permission_id AND source.name = 'authors.update'
JOIN permissions target ON target.name = 'authors.delete';

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, target.id
FROM role_permissions rp
JOIN permissions source ON source.id = rp.permission_id AND source.name = 'outlets.update'
JOIN permissions target ON target.name = 'outlets.delete';

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, target.id
FROM role_permissions rp
JOIN permissions source ON source.id = rp.permission_id
JOIN permissions target ON target.name = CASE source.name
  WHEN 'products.view' THEN 'categories.view'
  WHEN 'products.create' THEN 'categories.create'
  WHEN 'products.update' THEN 'categories.update'
  WHEN 'products.delete' THEN 'categories.delete'
END
WHERE source.name IN ('products.view', 'products.create', 'products.update', 'products.delete');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, target.id
FROM role_permissions rp
JOIN permissions source ON source.id = rp.permission_id AND source.name = 'outlet_types.manage'
JOIN permissions target ON target.name IN (
  'outlet_types.create', 'outlet_types.update', 'outlet_types.delete'
);

-- The requested assistant baseline is enabled now. The system owner can turn
-- any of these individual grants off later through the role-permission matrix.
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'assistant'
  AND p.name IN (
    'authors.view', 'authors.create', 'authors.update', 'authors.delete',
    'products.view', 'products.create', 'products.update', 'products.delete',
    'categories.view', 'categories.create', 'categories.update', 'categories.delete',
    'product_prices.view', 'product_prices.update',
    'outlet_types.view', 'outlet_types.create', 'outlet_types.update', 'outlet_types.delete',
    'outlets.view', 'outlets.create', 'outlets.update', 'outlets.delete', 'outlets.disable'
  );

-- Financial mutations remain owner-only even if an older application version
-- temporarily allowed one of them to be assigned to the assistant.
DELETE FROM role_permissions
WHERE role_id = (SELECT id FROM roles WHERE name = 'assistant')
  AND permission_id IN (
    SELECT id FROM permissions WHERE name IN (
      'invoices.pay',
      'payments.create', 'payments.reverse', 'payments.receipt.upload',
      'payments.mark_supplied', 'payments.supply_batch',
      'finance.adjust'
    )
  );

-- The aggregate outlet-type permission has been fully migrated to the three
-- granular permissions and is no longer part of the public permission catalog.
DELETE FROM role_permissions
WHERE permission_id = (SELECT id FROM permissions WHERE name = 'outlet_types.manage');

DELETE FROM permissions WHERE name = 'outlet_types.manage';
