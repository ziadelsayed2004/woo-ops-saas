# API Contract Outline

Base path: `/api/v1`. JSON errors use stable machine codes and a correlation ID.

## Contract conventions

- Authentication uses secure same-site cookies for the web application.
- Mutating requests require CSRF protection and an idempotency key where retryable.
- Organization context comes from the authenticated active membership, not a body/query tenant ID.
- Money is `{ "amountMinor": "12345", "currency": "EGP" }`.
- Cursor pagination returns `items`, `nextCursor`, `hasMore`, and an optional bounded estimate.
- Date-times are ISO-8601 UTC.
- Request and response schemas are shared TypeScript/Zod contracts and emitted as OpenAPI.

## Identity and organizations

```text
POST   /auth/login
POST   /auth/logout
POST   /auth/refresh
GET    /auth/session
GET    /organizations
POST   /organizations
POST   /organizations/:id/activate
GET    /members
POST   /members/invitations
PATCH  /members/:membershipId
DELETE /members/:membershipId
GET    /audit-events
```

## Connections

```text
GET    /connections
POST   /connections/woocommerce/authorize
GET    /connections/woocommerce/return
POST   /connections/woocommerce/callback
GET    /connections/:id
POST   /connections/:id/health-checks
POST   /connections/:id/sync-runs
POST   /connections/:id/reconcile
POST   /connections/:id/rotate
POST   /connections/:id/disable
GET    /connections/:id/fields
PUT    /connections/:id/field-mappings
POST   /connections/:id/field-mappings/backfill
POST   /webhooks/woocommerce/:publicConnectionToken
```

The authorization callback receiving Woo credentials is transport-isolated, strictly size-limited,
state-bound, and never exposed to browser JavaScript or ordinary request logs.

## Orders

```text
POST   /orders/query
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
      { "field": "exportState", "operator": "is-any-of", "value": ["never-exported", "changed-after-export"] },
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
  "sort": [
    { "field": "remoteCreatedAt", "direction": "desc" },
    { "field": "id", "direction": "desc" }
  ],
  "cursor": null,
  "limit": 50,
  "columns": ["orderNumber", "customer", "total", "shipping", "exportState"]
}
```

The server compiles only catalog-approved fields/operators. Never translate arbitrary client keys
directly to Mongo queries.

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
POST   /export-profiles/:id/versions
POST   /export-profiles/:id/preview

POST   /export-batches
GET    /export-batches
GET    /export-batches/:id
GET    /export-batches/:id/download
POST   /export-batches/:id/retry-failures
POST   /orders/:orderId/export-state/unexport
```

## Documents and printing

```text
GET    /document-templates
POST   /document-templates
POST   /document-templates/:id/versions
POST   /document-templates/:id/preview

POST   /document-jobs
GET    /document-jobs/:id
GET    /documents
GET    /documents/:id
GET    /documents/:id/download
POST   /documents/:id/supersede
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
GET    /analytics/rebuilds/:id
```

## Operations

```text
GET    /operations/health
GET    /operations/sync-runs
GET    /operations/jobs
GET    /operations/dead-letters
POST   /operations/dead-letters/:id/replay
GET    /operations/usage
```

## Error format

```json
{
  "error": {
    "code": "ORDER_FILTER_FIELD_NOT_ALLOWED",
    "message": "This filter field is not available for the active organization.",
    "details": {},
    "correlationId": "opaque-id"
  }
}
```

Internal stack traces, credentials, raw platform responses, Mongo errors, and tenant identifiers not
already authorized for the user are never returned.
