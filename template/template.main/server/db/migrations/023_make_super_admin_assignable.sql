-- Make super_admin role assignable
UPDATE roles SET is_assignable = 1 WHERE name = 'super_admin';
