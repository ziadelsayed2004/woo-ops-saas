-- Migration 018: Remove email column from authors table
PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS authors_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO authors_new (id, name, phone, status, created_at, updated_at)
SELECT id, name, phone, status, created_at, updated_at FROM authors;

DROP TABLE authors;

ALTER TABLE authors_new RENAME TO authors;

PRAGMA foreign_keys=ON;
