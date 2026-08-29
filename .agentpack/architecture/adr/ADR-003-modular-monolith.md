# ADR-003: Modular monolith with separate API and worker processes

- Status: accepted
- Date: 2026-08-27

## Context

The domain is broad, but premature microservices would multiply deployment, contracts, observability,
and consistency work. Sync, exports, and PDF rendering cannot live safely inside normal HTTP request
lifetimes.

## Decision

Build one TypeScript monorepo with domain-enforced modules and three deployables: web, API, worker.
Use Redis/BullMQ between API and worker. Split a module into a service only after measured scaling or
ownership boundaries justify it.

## Consequences

- Simple local development and atomic refactoring.
- API and workers scale independently.
- Package dependency boundaries and lint rules are required to prevent a distributed-monolith-in-one-
  repo.
