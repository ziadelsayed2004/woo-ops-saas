UPDATE roles
SET description = 'Operational assistant with limited account-linking and without financial access',
    updated_at = CURRENT_TIMESTAMP
WHERE name = 'assistant';
