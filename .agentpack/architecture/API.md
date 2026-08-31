# API Contract Outline

Base path: `/api/v1`. JSON errors use stable machine codes and a correlation ID.

## Contract conventions

- Authentication uses secure same-site cookies for the web application.
- Mutating requests require CSRF protection and an idempotency key where retryable.
- Account context comes from the authenticated active membership, not a body/query account ID.
- Money is `{ "amountMinor": "12345", "currency": "EGP" }`.
- Cursor pagination returns `items`, `nextCursor`, `hasMore`, and an optional bounded estimate.
- Date-times are ISO-8601 UTC.
- Request and response schemas are shared TypeScript/Zod contracts and emitted as OpenAPI.

## Identity and accounts

```text
POST   /auth/login
POST   /auth/logout
POST   /auth/password/change
POST   /auth/password/reset/request
POST   /auth/password/reset/confirm
GET    /auth/session
GET    /account
PATCH  /account
GET    /members
GET    /members/invitations
POST   /members/invitations
POST   /members/invitations/:invitationId/accept
POST   /members/invitations/:invitationId/revoke
PATCH  /members/:userId
DELETE /members/:userId
GET    /sessions
POST   /sessions/:sessionId/revoke
POST   /sessions/revoke-all
GET    /audit-events
```

Member and session responses are always scoped to the active authenticated membership. Invitation
acceptance binds the one-time token to the authenticated user's normalized email; the raw token is
returned only once to the creating administrator and is stored as a SHA-256 hash. Password reset
requests return the same `202 { accepted: true }` response for known and unknown emails. Reset
tokens are single-use, expire after 30 minutes, and are never returned by the API or written to logs.

## Connections

```text
GET    /connections
POST   /connections/woocommerce/authorize
GET    /connections/woocommerce/return
GET    /connections/woocommerce/return
GET    /connections/:id
POST   /connections/:id/health-checks
POST   /connections/:id/sync-runs
POST   /connections/:id/sync-runs/incremental
POST   /connections/:id/reconcile
POST   /connections/:id/rotate
POST   /connections/:id/disable
GET    /connections/:id/fields
PUT    /connections/:id/field-mappings
POST   /connections/:id/field-mappings/backfill
POST   /webhooks/woocommerce/:connectionId
```

The authorization callback receiving Woo credentials is transport-isolated, strictly size-limited,
state-bound, and never exposes credentials in browser responses or ordinary request logs. The
initial and incremental endpoints accept an idempotency key and enqueue durable read-only jobs;
reconciliation uses the same job contract and records remote deletions locally. Health responses
contain only safe version/capability and status data. Rotation and webhook-secret configuration
are account-administrator operations; secrets remain encrypted at rest.

The public Woo webhook endpoint accepts only verified `order.created`, `order.updated`, and
`order.deleted` topics. It stores the raw checksum-bound inbox record before enqueueing an
account-scoped processing job. Duplicate delivery IDs are acknowledged without a second effect.

## Orders

```text
POST   /orders/query
GET    /orders/filter-catalog
GET    /orders/:orderId
GET    /orders/:orderId/timeline
POST   /orders/:orderId/resync
PATCH  /orders/:orderId/local-workflow
POST   /orders/:orderId/tags
DELETE /orders/:orderId/tags/:tagId
POST   /orders/:orderId/notes

POST   /manual-orders
PATCH  /manual-orders/:orderId
POST   /manual-orders/:orderId/archive
```

Imported order commerce fields have no PATCH endpoint.

### Order query example

```json
{
  "filter": {
    "op": "and",
    "children": [
      { "field": "remoteCreatedAt", "operator": "between", "value": ["2026-08-01", "2026-08-31"] },
      {
        "field": "exportState",
        "operator": "is-any-of",
        "value": ["never-exported", "changed-after-export"]
      },
      {
        "op": "or",
        "children": [
          { "field": "shipping.methodId", "operator": "equals", "value": "flat_rate" },
          { "field": "origin", "operator": "equals", "value": "manual" }
        ]
      }
    ]
  },
  "search": "01001234567",
  "sort": { "field": "remoteCreatedAt", "direction": "desc" },
  "cursor": null,
  "limit": 50
}
```

The server compiles only catalog-approved fields/operators. Never translate arbitrary client keys
directly to SQL or storage queries.

`GET /orders/filter-catalog` returns the server-owned field/operator catalog. The order query
response is `{ items, nextCursor, hasMore, totalCount, facets }`; `facets` contains bounded counts
for status, source, export state, payment/shipping, POS/channel, product, category, author, and
SKU values calculated inside the authenticated account scope. Clients may send `includeFacets: false`
for a fast table refresh when facet counts are not needed; the default remains enabled. Cursor
sorting is stable and limited to approved fields. Remote commerce facts are immutable; local workflow commands use optimistic
`version` checks and are the only order mutations exposed by this workspace.

## Saved views and selection

```text
GET    /saved-views
POST   /saved-views
PATCH  /saved-views/:id
DELETE /saved-views/:id

POST   /selections
GET    /selections/:id
POST   /selections/:id/resolve-count
DELETE /selections/:id
```

## Bulk actions

```text
POST   /bulk-jobs
GET    /bulk-jobs
GET    /bulk-jobs/:id
POST   /bulk-jobs/:id/cancel
POST   /bulk-jobs/:id/retry-failures
GET    /bulk-jobs/:id/errors
```

Action payload references a selection ID and typed action parameters. Server authorization and
entitlement checks run both at job creation and execution.

The current API exposes these routes under `/api/v1`. Selection snapshots are either bounded
explicit IDs or a compact query plus exclusions and a UTC watermark; query snapshots exclude orders
created after that watermark. Bulk job creation is idempotent by account, action, and key, and job
progress is updated from per-order item results. Operation writes require an authenticated
owner/admin/operator session plus the CSRF token. Viewer sessions can preview and read progress but
cannot create, retry, or cancel jobs. The action allowlist is local/read-only (`resync` schedules a
read-only pull); no route in this group mutates WooCommerce.

## Export profiles and batches

```text
GET    /export-profiles
POST   /export-profiles
PATCH  /export-profiles/:id
GET    /export-profiles/:id/versions
POST   /export-profiles/:id/versions
POST   /export-profiles/:id/preview

POST   /export-batches
GET    /export-batches
GET    /export-batches/:id
GET    /export-batches/:id/download
GET    /export-batches/:id/errors
POST   /export-batches/:id/retry
POST   /export-batches/:id/retry-failures
POST   /export-batches/:id/mark-exported
POST   /orders/:orderId/export-state/unexport
```

Export profile versions are immutable and pin the row mode, canonical column paths, bounded
transforms/defaults/required fields, filename template, and output format. Preview responses are
bounded and may report truncation or required-field errors without creating a batch. Batch creation
returns a local `export.generate` durable job; the worker materializes an account-scoped order
snapshot in SQLite pages, writes the CSV/XLSX artifact below the private data root, and records its
checksum before a batch can be marked completed. Authenticated downloads re-check account scope,
the stored relative path, file size/checksum, and the immutable batch metadata. The retry and
`retry-failures` paths are aliases and create a new attempt while cancelling a queued/running stale
job. Exported order state is recorded only after successful artifact completion and never calls a
remote connector mutation method.

## Documents and printing

```text
GET    /document-templates
POST   /document-templates
PATCH  /document-templates/:id
POST   /document-templates/:id/preview
POST   /document-templates/:id/orders/:orderId

POST   /document-jobs
GET    /document-jobs
GET    /document-jobs/:batchId
GET    /document-jobs/:batchId/items
GET    /document-jobs/:batchId/errors
POST   /document-jobs/:batchId/retry-failures
POST   /document-jobs/:batchId/cancel
GET    /document-jobs/:batchId/artifacts
GET    /orders/:orderId/documents
GET    /document-files/:fileId
GET    /document-artifacts/:artifactId
GET    /document-identity-policy
PATCH  /document-identity-policy

`POST /document-jobs` snapshots the selected canonical orders and the immutable template version,
then enqueues one account-scoped `document.generate` job. The worker renders each order from that
snapshot, records a checksum-bound PDF or a bounded per-order failure, and continues so successful
documents remain downloadable when another order fails. Batch details expose resumable item
progress, immutable template/snapshot metadata, manifest, merged-PDF, ZIP, and per-order artifact
records. Retry re-queues only failed items and uses a new deterministic job attempt; cancellation
is local and never calls WooCommerce.

`GET /document-artifacts/:artifactId` is the only batch artifact stream. It requires an
authenticated account session, validates the account-scoped database record and checksum-bound
private path, sets `Content-Security-Policy: default-src 'none'`, `Cache-Control: private, no-store`,
and never serves from the public data directory. Template bodies accept only the allowlisted tokens
described in the UI specification and cannot load HTML, scripts, or URLs. Artifact ZIP manifests
and filenames are deterministic and reject traversal.

Invoice numbering and legal invoice wording are disabled by default. The identity-policy endpoint
requires an administrator and an explicit external approval reference before enabling legal invoice
mode; the application records the policy boundary but does not assert tax/legal compliance.
```

## Analytics

```text
POST   /analytics/summary
POST   /analytics/timeseries
POST   /analytics/breakdown
GET    /analytics/metric-definitions

GET    /cost-rules
POST   /cost-rules
PATCH  /cost-rules/:id
POST   /orders/:orderId/cost-overrides
POST   /analytics/rebuilds
```

Analytics summaries, time series, and breakdowns return currency-separated metric totals; the API
never silently adds amounts from different currencies. Each metric definition includes its formula
and excluded order statuses. Rebuilds are durable, account-scoped `analytics.rebuild` jobs with
bounded progress and retry/recovery semantics; they read canonical local orders and persist
versioned daily facts plus immutable line-cost snapshots. Cost overrides are append-only,
account-scoped events and the latest event for a line is applied during the next rebuild without
altering the remote order snapshot. Analytics filters accept inclusive date bounds, source (`woo`,
`manual`, or `combined`), store / connection ID, status, shipping method, product or SKU, category,
and author text facets. Breakdown dimensions include source, store, status, shipping, product,
category, and author. Summary responses expose the latest fact rebuild timestamp and account-wide
cost-snapshot coverage (`scope: account`) so clients can show freshness and partial-cost states
explicitly without implying that coverage is a date/facet-level estimate.

## Operations

```text
GET    /operations/health
GET    /operations/sync-runs
GET    /operations/jobs
GET    /operations/jobs/:id
POST   /operations/jobs/:id/cancel
GET    /operations/dead-letters
POST   /operations/dead-letters/:id/replay
GET    /operations/usage
POST   /operations/maintenance
```

Operations job list/detail responses contain only account-scoped summaries: ID, type, status,
attempts, progress, lease/cancellation state, timestamps, and a bounded redacted error. They never
return `payload_json`, raw webhook bodies, credentials, or a client-selected `accountId`. List
queries use a bounded cursor, limit, closed job-type catalog, and stable `updatedAt/id` ordering.
`POST /operations/jobs/:id/cancel` requires an owner/admin/operator session and CSRF; dead-letter
replay has the same permission and resets attempts while preserving the original idempotency key.
Worker execution derives its account context from the claimed row and has no remote Woo mutation
port. `/operations/health` reports the authenticated account's queue counts and runner registration
state; `/operations/usage` reports counts and payload byte totals, not payload values.

`GET /health` and `GET /ready` report database connectivity, applied schema version, private
storage accessibility, and queue counts. They return `503` with `status: degraded` when a
production readiness dependency is unavailable.

## Error format

```json
{
  "error": {
    "code": "ORDER_FILTER_FIELD_NOT_ALLOWED",
    "message": "This filter field is not available for the active account.",
    "details": {},
    "correlationId": "opaque-id"
  }
}
```

Internal stack traces, credentials, raw platform responses, database errors, and account identifiers not
already authorized for the user are never returned.
