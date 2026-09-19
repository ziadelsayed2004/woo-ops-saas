ALTER TABLE invoices ADD COLUMN archived_at DATETIME;
ALTER TABLE invoices ADD COLUMN archived_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_archived_at ON invoices (archived_at);

INSERT OR IGNORE INTO permissions (name, description)
VALUES ('invoices.archive', 'Permission to archive and restore invoices');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name = 'invoices.archive'
WHERE r.name IN ('super_admin', 'assistant');
