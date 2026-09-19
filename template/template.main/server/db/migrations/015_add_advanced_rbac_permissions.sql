-- Insert new granular permissions
INSERT OR IGNORE INTO permissions (name, description) VALUES ('invoices.pay', 'Permission to record invoice payments and mark paid');
INSERT OR IGNORE INTO permissions (name, description) VALUES ('invoices.ship', 'Permission to create shipments for invoice items');
INSERT OR IGNORE INTO permissions (name, description) VALUES ('invoices.return', 'Permission to create returns for invoice items');
INSERT OR IGNORE INTO permissions (name, description) VALUES ('payments.receipt.view', 'Permission to view payment receipt files');
INSERT OR IGNORE INTO permissions (name, description) VALUES ('payments.receipt.upload', 'Permission to upload payment receipts');
INSERT OR IGNORE INTO permissions (name, description) VALUES ('shipments.deliver', 'Permission to deliver shipped packages');
INSERT OR IGNORE INTO permissions (name, description) VALUES ('returns.create', 'Permission to create client returns');

-- Assign these to super_admin and admin roles
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name IN ('super_admin', 'admin') AND p.name IN (
  'invoices.pay',
  'invoices.ship',
  'invoices.return',
  'payments.receipt.view',
  'payments.receipt.upload',
  'shipments.deliver',
  'returns.create'
);
