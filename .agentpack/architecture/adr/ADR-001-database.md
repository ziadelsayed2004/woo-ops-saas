# ADR-001: SQLite as the deployment database

- Status: accepted
- Date: 2026-08-29

## Decision

Each installation uses one SQLite database file under a configurable private data directory. SQLite
runs in WAL mode with foreign keys enabled. Versioned idempotent migrations manage schema changes.
Durable jobs in SQLite allow sync, exports, documents, analytics and backups to survive restarts.

## Constraints

The supported profile is single-installation/single-account and is not horizontally scaled. Persistence
ports remain replaceable so a future hosted edition can add another adapter. Generated files live outside
the public web root and are included in backups.

## Consequences

- Local and Hostinger deployments share the same database behavior.
- WAL, busy timeouts, bounded jobs and scheduled backups are mandatory.
- Horizontal multi-instance deployment is out of scope for this profile.
