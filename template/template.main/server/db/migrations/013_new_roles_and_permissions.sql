-- 1. Create new roles in database
INSERT OR IGNORE INTO roles (name, description) VALUES ('assistant', 'Assistant with limited permissions');
INSERT OR IGNORE INTO roles (name, description) VALUES ('visitor', 'Visitor with financials view-only permissions');

-- 2. Link permissions to assistant role
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'assistant' AND p.name IN (
  'products.view',
  'outlets.view',
  'outlet_types.view',
  'authors.view',
  'invoices.view',
  'invoices.create',
  'invoices.update',
  'invoices.export',
  'inventory.view',
  'shipments.view',
  'shipments.create',
  'shipments.update',
  'reports.view',
  'notifications.view',
  'notifications.manage'
);

-- 3. Link permissions to visitor role
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'visitor' AND p.name IN (
  'finance.view',
  'finance.statement.view',
  'payments.view',
  'invoices.view',
  'products.view',
  'outlets.view'
);

-- 4. Link permissions to shipping_user role
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'shipping_user' AND p.name IN (
  'shipments.view',
  'shipments.create',
  'shipments.update',
  'invoices.view',
  'products.view',
  'outlets.view'
);
