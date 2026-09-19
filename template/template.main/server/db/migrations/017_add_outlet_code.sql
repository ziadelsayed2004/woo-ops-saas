-- Add code column to outlets
ALTER TABLE outlets ADD COLUMN code TEXT;

-- Create unique index to enforce uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS idx_outlets_code ON outlets(code);

-- Backfill codes for any existing outlets dynamically based on ID
UPDATE outlets 
SET code = 'OUT-' || SUBSTR('000000' || id, -7)
WHERE code IS NULL;
