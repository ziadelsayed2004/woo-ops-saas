# ADR-001: MongoDB Atlas, not SQLite, for production orders

- Status: accepted
- Date: 2026-08-27

## Context

The product is a multi-tenant SaaS with concurrent webhooks, polling, manual order edits, exports,
PDF jobs, analytics rebuilds, sessions, and audit events. It must run without a self-managed VPS.

SQLite is operationally attractive but allows one writer at a time. A single local database file is
also a poor boundary for independently scaled API and worker containers, failover, managed backups,
and multi-instance deployments.

## Decision

Use managed MongoDB Atlas as the production database and Mongoose behind tenant-scoped repository
ports. Use Free for development/proof of concept, Flex for a monitored low-throughput pilot, and
Dedicated when production requirements demand it.

SQLite is permitted only for isolated local tooling metadata or tests that do not claim production
database parity. The application domain must not implement a second SQLite persistence layer.

## Consequences

- MERN remains literal and the document model fits varying remote metadata and embedded line
  snapshots.
- No VPS is needed for the database.
- Atlas networking, connection pooling, tier limits, indexes, and backups are deployment concerns.
- Correct denormalization and bounded document design remain mandatory.
- Production readiness cannot be claimed on a free proof-of-concept tier.

## References

- https://sqlite.org/whentouse.html
- https://www.mongodb.com/docs/atlas/create-database-deployment/
- https://www.mongodb.com/docs/atlas/manage-flex-clusters/
