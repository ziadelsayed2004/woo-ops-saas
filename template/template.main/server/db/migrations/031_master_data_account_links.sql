-- Give operational editors a narrow way to link existing active login accounts
-- to authors and outlets without granting general user-management access.
INSERT OR IGNORE INTO permissions (name, description) VALUES
  ('authors.account_link', 'Link an active login account to an author'),
  ('outlets.account_link', 'Link an active login account to an outlet');

-- Keep the requested assistant master-data baseline available on existing
-- installations. These grants remain configurable through the role matrix.
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'assistant'
  AND p.name IN (
    'authors.view', 'authors.create', 'authors.update', 'authors.delete',
    'authors.account_link',
    'products.view', 'products.create', 'products.update', 'products.delete',
    'categories.view', 'categories.create', 'categories.update', 'categories.delete',
    'product_prices.view', 'product_prices.update',
    'outlet_types.view', 'outlet_types.create', 'outlet_types.update', 'outlet_types.delete',
    'outlets.view', 'outlets.create', 'outlets.update', 'outlets.delete', 'outlets.disable',
    'outlets.account_link'
  );

-- The owner receives every registered permission through the normal RBAC
-- lookup, but keep the explicit assignment consistent for role inspections.
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'super_admin';
