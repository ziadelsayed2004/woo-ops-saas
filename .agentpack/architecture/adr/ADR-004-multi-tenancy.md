# ADR-004: Shared database with mandatory tenant-scoped repositories

- Status: accepted
- Date: 2026-08-27

## Context

The first customer may use one organization, but the product is SaaS and must support many merchants.

## Decision

Use a shared MongoDB deployment and shared collections with `organizationId` on every tenant-owned
record. HTTP controllers and job handlers access data only through repositories requiring a
server-created `TenantContext`. Cache, files, search, locks, idempotency, and audit use the same
scope.

## Consequences

- Efficient early SaaS operation and migrations.
- Isolation relies on systemic application controls and exhaustive negative tests.
- Enterprise database-per-tenant can be added behind repository routing later without changing the
  domain contract.
