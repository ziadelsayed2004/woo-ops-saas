-- Central role metadata and terminal user archiving support.
ALTER TABLE roles ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1));
ALTER TABLE roles ADD COLUMN is_assignable INTEGER NOT NULL DEFAULT 1 CHECK (is_assignable IN (0, 1));
ALTER TABLE roles ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1));

ALTER TABLE users ADD COLUMN archived_username TEXT;
ALTER TABLE users ADD COLUMN archived_at DATETIME;

CREATE INDEX IF NOT EXISTS idx_roles_active_assignable ON roles (is_active, is_assignable);
CREATE INDEX IF NOT EXISTS idx_users_archived_username ON users (archived_username);

-- Ensure every permission exists before role grants are synchronized. This is
-- required on fresh databases because migrations run before the development seed.
INSERT OR IGNORE INTO permissions (name, description) VALUES
  ('users.view', 'Permission to access users.view'),
  ('users.create', 'Permission to access users.create'),
  ('users.update', 'Permission to access users.update'),
  ('users.disable', 'Permission to access users.disable'),
  ('users.archive', 'Permission to access users.archive'),
  ('roles.view', 'Permission to view roles and permissions'),
  ('roles.manage', 'Permission to access roles.manage'),
  ('permissions.manage', 'Permission to access permissions.manage'),
  ('authors.view', 'Permission to access authors.view'),
  ('authors.create', 'Permission to access authors.create'),
  ('authors.update', 'Permission to access authors.update'),
  ('products.view', 'Permission to access products.view'),
  ('products.create', 'Permission to access products.create'),
  ('products.update', 'Permission to access products.update'),
  ('products.delete', 'Permission to access products.delete'),
  ('product_prices.view', 'Permission to access product_prices.view'),
  ('product_prices.update', 'Permission to access product_prices.update'),
  ('outlet_types.view', 'Permission to access outlet_types.view'),
  ('outlet_types.manage', 'Permission to access outlet_types.manage'),
  ('outlets.view', 'Permission to access outlets.view'),
  ('outlets.create', 'Permission to access outlets.create'),
  ('outlets.update', 'Permission to access outlets.update'),
  ('outlets.disable', 'Permission to access outlets.disable'),
  ('invoices.view', 'Permission to access invoices.view'),
  ('invoices.create', 'Permission to access invoices.create'),
  ('invoices.update', 'Permission to access invoices.update'),
  ('invoices.cancel', 'Permission to access invoices.cancel'),
  ('invoices.export', 'Permission to access invoices.export'),
  ('invoices.pay', 'Permission to record invoice payments and mark paid'),
  ('invoices.ship', 'Permission to create shipments for invoice items'),
  ('invoices.return', 'Permission to create returns for invoice items'),
  ('invoices.archive', 'Permission to archive and restore invoices'),
  ('payments.view', 'Permission to access payments.view'),
  ('payments.create', 'Permission to access payments.create'),
  ('payments.reverse', 'Permission to access payments.reverse'),
  ('payments.receipt.view', 'Permission to view payment receipt files'),
  ('payments.receipt.upload', 'Permission to upload payment receipts'),
  ('payments.mark_supplied', 'Permission to access payments.mark_supplied'),
  ('payments.supply_batch', 'Permission to access payments.supply_batch'),
  ('inventory.view', 'Permission to access inventory.view'),
  ('inventory.receipts.create', 'Permission to access inventory.receipts.create'),
  ('inventory.adjustments.create', 'Permission to access inventory.adjustments.create'),
  ('shipments.view', 'Permission to access shipments.view'),
  ('shipments.create', 'Permission to access shipments.create'),
  ('shipments.update', 'Permission to access shipments.update'),
  ('returns.view', 'Permission to access returns.view'),
  ('returns.create', 'Permission to create client returns'),
  ('reports.view', 'Permission to access reports.view'),
  ('reports.export', 'Permission to access reports.export'),
  ('exports.run', 'Permission to access exports.run'),
  ('audit.view', 'Permission to access audit.view'),
  ('settings.update', 'Permission to access settings.update'),
  ('backup.create', 'Permission to access backup.create'),
  ('backup.restore', 'Permission to access backup.restore'),
  ('finance.view', 'Permission to access finance.view'),
  ('finance.adjust', 'Permission to access finance.adjust'),
  ('finance.export', 'Permission to access finance.export'),
  ('finance.statement.view', 'Permission to access finance.statement.view'),
  ('notifications.view', 'Permission to access notifications.view'),
  ('notifications.manage', 'Permission to access notifications.manage');

INSERT OR IGNORE INTO roles (name, description) VALUES
  ('super_admin', 'System owner with unrestricted access'),
  ('assistant', 'Operational assistant without identity or financial access'),
  ('readonly_viewer', 'General read-only system monitor'),
  ('shipping_user', 'Shipping and logistics operator'),
  ('inventory_manager', 'Inventory and stocktaking operator'),
  ('author', 'Author account restricted to linked author data'),
  ('outlet', 'Outlet account restricted to linked outlet data'),
  ('admin', 'Deprecated administrator role'),
  ('accountant', 'Deprecated accountant role'),
  ('sales_staff', 'Deprecated sales role'),
  ('visitor', 'Deprecated visitor role');

UPDATE roles
SET description = CASE name
      WHEN 'super_admin' THEN 'System owner with unrestricted access'
      WHEN 'assistant' THEN 'Operational assistant without identity or financial access'
      WHEN 'readonly_viewer' THEN 'General read-only system monitor'
      WHEN 'shipping_user' THEN 'Shipping and logistics operator'
      WHEN 'inventory_manager' THEN 'Inventory and stocktaking operator'
      WHEN 'author' THEN 'Author account restricted to linked author data'
      WHEN 'outlet' THEN 'Outlet account restricted to linked outlet data'
      WHEN 'admin' THEN 'Deprecated administrator role'
      WHEN 'accountant' THEN 'Deprecated accountant role'
      WHEN 'sales_staff' THEN 'Deprecated sales role'
      WHEN 'visitor' THEN 'Deprecated visitor role'
      ELSE description
    END,
    is_system = 1,
    is_assignable = CASE
      WHEN name IN ('assistant', 'readonly_viewer', 'shipping_user', 'inventory_manager', 'author', 'outlet') THEN 1
      ELSE 0
    END,
    is_active = CASE
      WHEN name IN ('admin', 'accountant', 'sales_staff', 'visitor') THEN 0
      ELSE 1
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE name IN (
  'super_admin', 'assistant', 'readonly_viewer', 'shipping_user',
  'inventory_manager', 'author', 'outlet',
  'admin', 'accountant', 'sales_staff', 'visitor'
);

-- System-role grants converge to the catalog instead of accumulating stale
-- grants from old migrations or seeds.
DELETE FROM role_permissions
WHERE role_id IN (
  SELECT id FROM roles WHERE is_system = 1
);

-- Owner-only capabilities can never be delegated through a custom role.
DELETE FROM role_permissions
WHERE role_id IN (SELECT id FROM roles WHERE is_system = 0)
  AND permission_id IN (
    SELECT id FROM permissions
    WHERE name IN (
      'users.create', 'users.update', 'users.disable', 'users.archive',
      'roles.manage', 'permissions.manage',
      'invoices.pay',
      'payments.create', 'payments.reverse', 'payments.receipt.upload',
      'payments.mark_supplied', 'payments.supply_batch',
      'finance.adjust',
      'backup.create', 'backup.restore',
      'settings.update'
    )
  );

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'super_admin';

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'assistant'
  AND p.name IN (
    'authors.view', 'authors.create', 'authors.update',
    'products.view', 'products.create', 'products.update', 'products.delete',
    'product_prices.view', 'product_prices.update',
    'outlet_types.view', 'outlet_types.manage',
    'outlets.view', 'outlets.create', 'outlets.update', 'outlets.disable',
    'invoices.view', 'invoices.create', 'invoices.update', 'invoices.cancel', 'invoices.export',
    'invoices.ship', 'invoices.return', 'invoices.archive',
    'inventory.view', 'inventory.receipts.create', 'inventory.adjustments.create',
    'shipments.view', 'shipments.create', 'shipments.update',
    'returns.view', 'returns.create',
    'reports.view', 'reports.export', 'exports.run',
    'notifications.view', 'notifications.manage'
  );

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'readonly_viewer'
  AND p.name IN (
    'users.view', 'roles.view',
    'authors.view', 'products.view', 'product_prices.view',
    'outlet_types.view', 'outlets.view',
    'invoices.view', 'invoices.export',
    'payments.view', 'payments.receipt.view',
    'inventory.view', 'shipments.view', 'returns.view',
    'reports.view', 'reports.export', 'exports.run', 'audit.view',
    'finance.view', 'finance.export', 'finance.statement.view',
    'notifications.view'
  );

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'shipping_user'
  AND p.name IN (
    'invoices.view', 'invoices.export', 'invoices.ship',
    'shipments.view', 'shipments.create', 'shipments.update'
  );

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'inventory_manager'
  AND p.name IN (
    'products.view',
    'invoices.view', 'invoices.export',
    'inventory.view', 'inventory.receipts.create', 'inventory.adjustments.create'
  );

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'author'
  AND p.name IN ('products.view', 'invoices.view', 'finance.view');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'outlet'
  AND p.name IN ('invoices.view', 'shipments.view', 'finance.view', 'finance.statement.view');

-- Users relying exclusively on a deprecated role lose no history but are
-- disabled until the system owner assigns an active role.
UPDATE users
SET status = 'disabled', updated_at = CURRENT_TIMESTAMP
WHERE status = 'active'
  AND EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = users.id AND r.is_active = 0
  )
  AND NOT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = users.id AND r.is_active = 1
  );

-- Preserve a readable snapshot before terminally detaching already archived
-- accounts from their current role/partner links.
INSERT INTO audit_logs (user_id, action, target_type, target_id, details, ip_address)
SELECT
  NULL,
  'archive_user_migration_snapshot',
  'users',
  CAST(u.id AS TEXT),
  json_object(
    'originalUsername', u.username,
    'fullName', u.full_name,
    'statusBefore', u.status,
    'roles', COALESCE((
      SELECT group_concat(r.name, ',')
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = u.id
    ), ''),
    'authorIds', COALESCE((
      SELECT group_concat(au.author_id, ',') FROM author_users au WHERE au.user_id = u.id
    ), ''),
    'outletIds', COALESCE((
      SELECT group_concat(ou.outlet_id, ',') FROM outlet_users ou WHERE ou.user_id = u.id
    ), '')
  ),
  NULL
FROM users u
WHERE u.status = 'archived' AND u.archived_username IS NULL;

UPDATE users
SET archived_username = username,
    archived_at = COALESCE(updated_at, CURRENT_TIMESTAMP),
    username = '__archived__' || id || '__' || lower(hex(randomblob(16))),
    updated_at = CURRENT_TIMESTAMP
WHERE status = 'archived' AND archived_username IS NULL;

DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE status = 'archived');
DELETE FROM author_users WHERE user_id IN (SELECT id FROM users WHERE status = 'archived');
DELETE FROM outlet_users WHERE user_id IN (SELECT id FROM users WHERE status = 'archived');
