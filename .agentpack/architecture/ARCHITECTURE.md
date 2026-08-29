# Woo Ops Architecture

## Runtime

```text
Browser -> Vite static assets -> Express Node application
                                  -> SQLite (WAL, migrations, durable jobs)
                                  -> private local files (PDF/XLSX/backups)
WooCommerce -> read-only REST v3/webhook endpoints -> durable local records
```

The supported deployment is one Node process per merchant installation. The process serves the API,
the built web application and a bounded in-process job runner. Hostinger Cron can trigger job draining
and backups. No remote commerce mutation capability exists.

## Package boundaries

```text
apps/web          React/Vite/Material UI operator application
apps/api          Express HTTP, auth, webhooks, jobs and static serving
packages/domain   money, order invariants and pure business rules
packages/application use cases and persistence/job ports
packages/contracts Zod HTTP/job schemas
packages/persistence SQLite repositories, migrations and backup metadata
packages/connectors read-only connector SDK and adapters
packages/documents PDF/thermal/label contracts and rendering
packages/exports export profiles, transforms and file contracts
packages/analytics metrics, costs and facts
packages/observability redacted logs, correlation and audit helpers
packages/ui       shared localization and accessible UI primitives
```

Domain/application packages do not import Express, React, SQLite drivers or Woo clients. Infrastructure
implements ports. The connector SDK contains pull, health, authorization and webhook verification only;
it must never expose update-order, update-status, stock, product, customer or unrestricted HTTP methods.

## Data and jobs

Every installation has an authenticated account boundary. Remote Woo facts are normalized into local
immutable snapshots. Local workflow, exported state, notes, tags, assignments, documents and manual
orders are owned by the application. Manual orders always use `syncPolicy=never` and
`inventoryPolicy=ignore`.

Requests create small, versioned durable jobs. Job handlers use lease-safe transitions, deterministic
idempotency keys, bounded retries and dead-letter records. Exports and documents are generated from
immutable snapshots and stored outside the public web root.

Money uses integer minor units plus ISO currency. Dates persist in UTC with source timezone/raw values
when needed. API filters are server-catalogued typed ASTs; clients cannot submit SQL or arbitrary paths.

## Future portability

The first connector is WooCommerce REST v3. A future platform adapter implements the connector port and
normalization fixtures; order, export, document and analytics modules remain platform-neutral. A future
hosted edition can replace SQLite/files/jobs adapters while preserving application contracts.
