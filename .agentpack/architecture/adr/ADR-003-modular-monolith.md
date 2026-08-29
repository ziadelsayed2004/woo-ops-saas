# ADR-003: Single-process modular monolith

- Status: accepted
- Date: 2026-08-29

## Decision

Build one TypeScript monorepo with a Vite React web app and an Express Node app. The API and an
in-process durable job runner share application/domain packages. Jobs use SQLite leases, retries and
dead-letter status. Hostinger Cron may invoke a protected maintenance endpoint or CLI command.

Long work never runs inside a request; requests create durable jobs and return job IDs. A future worker
can consume the same job port without changing domain modules.
