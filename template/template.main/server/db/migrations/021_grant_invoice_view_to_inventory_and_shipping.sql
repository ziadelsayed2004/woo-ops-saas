-- Allow inventory and shipping users to view the incomplete invoices in their access scope.
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('inventory_manager', 'shipping_user')
  AND p.name = 'invoices.view';
