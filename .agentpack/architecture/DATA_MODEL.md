# Canonical Data Model

## Storage conventions

- Every account-owned row includes `accountId` as the leading scope key in applicable indexes.
- Use opaque application IDs; external IDs are namespaced by connection.
- Use integer minor money units and ISO currency.
- Use optimistic `version` for mutable local aggregates.
- Use `createdAt`, `updatedAt`, `createdBy`, and `updatedBy` where actor attribution is meaningful.
- Never index arbitrary raw Woo metadata. Index configured, typed mappings only.

## Core tables

### accounts

Identity, locale, timezone, base currency, retention policy, plan, document identity, and status.

Indexes:

- unique slug
- status + plan

### users, sessions, memberships

Users hold global identity. Memberships map user to account, role, permissions override, and
state (`active` or `revoked`) with update/revocation timestamps. Sessions are hashed, revocable,
rotated on password or role changes, account-scoped, and device-aware. Password reset tokens are
hashed, account-bound, single-use records with an expiry; invitation records are account-scoped,
hashed-token, role-limited, and have accepted/revoked/expiry state.

Indexes:

- unique normalized email
- unique account + user membership
- session hash and expiry TTL
- account + membership status and user + membership status
- password reset token hash, used state, and expiry
- pending invitation email per account

### storeConnections

```text
accountId
platform
canonicalStoreUrl
externalStoreIdentity
displayName
encryptedCredentialEnvelope
capabilities
status
health
syncPolicy
cursors
webhookConfiguration
sourceTimezone
fieldCatalogVersion
```

Indexes:

- unique account + platform + canonicalStoreUrl
- account + status
- health.nextCheckAt

The SQLite deployment stores the connection lifecycle in `connections`: the encrypted credential
and webhook-secret envelopes are private worker fields, while list/detail responses expose only
status, health timestamps, versions, capabilities, source timezone, and sync counters/cursor.
Migration 16 adds those lifecycle fields and the account-first status index. Credentials are never
copied into jobs, audit summaries, or API responses.

### products

Canonical product/variation catalog snapshots for filtering and manual-order lookup.

```text
accountId
connectionId
externalProductId
externalVariationId?
name, normalizedName, sku
type, status
categories[], tags[], shippingClass
attributes[]
mappedFacets { authors[], ... }
remoteCreatedAt, remoteModifiedAt
sourceHash, normalizationVersion
deletedRemotelyAt?
```

Indexes:

- unique account + connection + external product + external variation
- account + connection + normalized SKU
- account + category IDs
- account + mapped author IDs
- search index for name/SKU/configured fields

### orders

```text
identity:
  accountId, id, origin, connectionId?, platform?, externalOrderId?, orderNumber

source:
  remoteStatus?, createdVia?, channel, posLocation?, remoteCreatedAt?, remoteModifiedAt?
  sourceTimezone?, sourceHash?, normalizationVersion, remoteDeletedAt?

local:
  localStatus, assigneeId?, tags[], notesSummary, syncPolicy, inventoryPolicy, version

customer:
  externalCustomerId?, name, normalizedName, email, normalizedEmail, phone, normalizedPhone

billing / shipping:
  immutable normalized address fields plus raw-compatible values

lines[]:
  lineId, externalLineId?, productRef?, externalProductId?, variationId?, sku, name
  quantity, subtotalMinor, discountMinor, totalMinor, taxMinor
  productSnapshot { name, sku, categories, authors, attributes }
  costSnapshot { unitCostMinor?, source?, effectiveAt? }
  mappedFields[]

amounts:
  currency, merchandiseSubtotalMinor, discountMinor, merchandiseNetMinor, shippingCollectedMinor
  taxMinor, feesMinor, refundMinor, grandTotalMinor, collectedMinor

payment:
  methodId, title, status, paidAt?, transactionReferenceMasked?

shippingMethod:
  methodId, title, instanceId?, carrier?, collectedMinor, actualCostMinor?

refunds[]:
  externalRefundId?, amountMinor, reason, createdAt, lineAllocations[]

exportSummary:
  state, firstExportedAt?, lastExportedAt?, exportCount, lastBatchId?, lastSnapshotHash?

artifactSummary:
  latestInvoiceId?, latestLabelId?, staleSince?

search:
  compact normalized search/facet fields
```

SQLite implementation details (migration 17):

- `orders` stores an account-scoped canonical projection for customer name/email/phone, remote
  creation time and timezone, channel/POS, payment and shipping identifiers/status, integer-minor
  amount components, quantity, refund/exception state, and bounded JSON arrays for product,
  variation, SKU, category, author, remote-tag, and coupon facets.
- `search_text` is a bounded, lower-cased projection used with escaped LIKE search; raw Woo
  payloads remain private in `remote_payload_json` and are never returned by ordinary order APIs.
- `order_timeline_events` stores account/order-scoped remote, local, and system timeline events
  with unique idempotency keys and bounded summaries. Local workflow/tag/note/resync events are
  append-only and auditable.
- Query facets are calculated from fixed SQL expressions and `json_each` over approved projection
  columns; arbitrary field names and SQL are never accepted from clients.

Imported and manual orders share one read shape. Manual-only editable subdocuments may use a
separate command model or guarded updates, but API responses remain canonical.

Required indexes:

- unique partial: account + connection + externalOrderId for imported orders
- unique: account + orderNumber
- account + remoteCreatedAt + `_id`
- account + connection + remoteStatus + remoteCreatedAt
- account + localStatus + remoteCreatedAt
- account + exportSummary.state + remoteCreatedAt
- account + shippingMethod.methodId + remoteCreatedAt
- account + line product references
- account + line category/author facets
- account + normalized phone/email
- SQLite FTS5 index for approved search fields when enabled
- migration 17 account-first indexes for remote creation, channel/POS, payment, shipping, amounts,
  quantity, refund/exception, customer contact, and the bounded search projection

### remoteSnapshots

Optionally separated encrypted/compressed payloads keyed by account, connection, entity type,
entity ID, source hash, and received time. Ordinary APIs never return this table. Retention can
be shorter than canonical order retention.

### fieldCatalogs and fieldMappings

Catalog entries describe observed source path, scope, sample-safe type evidence, frequency, and
sensitivity classification. Mapping versions convert approved source values into typed custom
fields or canonical facets.

### selectionSnapshots

Short-lived selection contract for bulk actions. Includes filter AST, sort, exclusions, watermark,
estimated/resolved counts, creator, expiry, and query hash. TTL index removes unused selections.

### bulkJobs

Job summary, action, parameters, selection ID, state, progress counters, error categories, result
manifest, actor, correlation ID, timestamps, and idempotency key.

Indexes:

- unique account + type + idempotency key
- account + state + createdAt
- TTL for old detailed item results according to retention

### jobs

Durable execution envelope with `accountId`, closed-catalog `type`, idempotency key, compact
validated payload, status, attempt/max-attempt counters, availability time, lease expiry,
cancel-request flag, progress, bounded redacted error, and UTC timestamps. Payloads are available
only to the worker effect boundary; operations responses expose summaries and usage counts without
payload contents or credentials. A bulk job with work creates one `bulk.process` envelope and may
schedule deterministic child export, document, or read-only sync envelopes.

Indexes:

- unique account + type + idempotency key
- account + status + createdAt
- account + status + availableAt + createdAt for claims

Worker transitions are lease-guarded and account-scoped. Expired leases are re-queued (or marked
cancelled), retries use bounded exponential backoff, and exhausted attempts become inspectable
dead letters. Replay resets only execution state and retains the original payload and idempotency
identity.

### exportProfiles and exportProfileVersions

Mutable profile identity plus immutable versions. Version stores row mode, column sources,
transform pipeline, validation, filename expression, locale, and output type.

### exportBatches

Immutable execution record: selection snapshot, profile version, data watermark, order snapshot
manifest, result counts, file metadata/checksum, actor, state, errors, and timestamps.

SQLite implementation details (migration 18):

- `export_batches` stores the durable `export.generate` job ID, deterministic selection snapshot
  hash, final order-snapshot hash, bounded snapshot cursor/count/completion state, attempt count,
  result metadata, and checksum-bound private file path.
- `export_batch_snapshots` stores one immutable canonical order JSON snapshot per account/batch
  position with a per-row SHA-256 hash. Composite account-first foreign keys and unique indexes
  prevent cross-account reads or duplicate positions/order IDs.
- Export creation and its durable job insert are one transaction. Snapshot materialization is
  resumable in pages of at most 5,000 orders. The current in-process worker bounds generation to
  100,000 orders/200,000 rows; large inputs fail with an explicit limit instead of allocating an
  unbounded request-sized structure.
- Artifacts live under the configured private data directory, outside the public web root. The
  file helper creates account/batch directories with restrictive permissions, rejects traversal or
  symlink chains, writes at most 100 MiB, and allows only write-once checksum-compatible files.

### orderExportEvents

Append-only per-order history allowing reliable derived export state and unexport audit without
editing old export batches.

### documentTemplates and documentTemplateVersions

Safe template identity plus immutable HTML/CSS/token contract versions. No arbitrary remote script,
network fetch, or executable template expression.

### documentIdentityPolicies, documentBatches, documentBatchItems, and documentArtifacts

SQLite migration 19 adds the durable batch/document boundary:

- `document_identity_policies` stores the local invoice numbering switch, safe prefix, next
  sequence, and administrator-supplied external approval reference. Legal invoice mode is rejected
  unless numbering and the approval reference are both configured; this is a policy boundary, not
  legal or tax approval.
- `document_batches` pins the account, selection, template ID/version, complete template snapshot,
  physical format, action, deterministic idempotency key, aggregate snapshot hash, progress counts,
  durable job ID, and artifact IDs. Creation snapshots no more than 500 authenticated orders in one
  transaction, so later remote/local edits cannot change an in-flight document.
- `document_batch_items` stores each immutable canonical order snapshot and hash, zero-based stable
  position, optional reserved invoice number, attempt/status/error, and the checksum-bound order PDF
  artifact ID. A worker lease recovery re-queues only items left running and keeps successful items
  reusable.
- `document_artifacts` stores account/batch/order ownership, template version, format, artifact kind
  (`order-pdf`, `merged-pdf`, `zip`, or `manifest`), private relative path, safe filename, MIME,
  bounded byte size, content checksum, source snapshot hash, and actor/timestamp metadata. Files
  remain outside SQLite and outside the public web root; every download rechecks the private path
  chain and checksum.

Required indexes include account/status/update order for batch lists, account/batch/status/position
for bounded worker claims, and account/batch/order lookups for artifact lists and authorization.
Merged PDFs, ZIP bundles, and JSON manifests are derived artifacts; per-order PDFs remain available
when a batch is partial. Retry creates a new job attempt without mutating old artifact records.

### documentSequences

Atomic counter per approved sequence scope. Counter increments are irreversible; gaps are recorded
with reason rather than reused.

### documents

Immutable order snapshot, template version, sequence value, format, dimensions, storage file,
checksum, generated-by, timestamps, and supersession relationship.

### costRules, orderCostSnapshots and orderCostOverrides

Effective-dated product/variation/shipping/payment/return cost rules. Calculation records the exact
rule version and inputs. Schema migration 20 adds account-scoped `order_cost_overrides` append-only
events (`order_id`, optional `line_id`, ISO currency, integer minor-unit cost, actor, reason, and
timestamp). The latest override for a line is applied by an analytics rebuild; it never mutates the
remote snapshot or the historical override events.

### dailyOrderFacts

Rebuildable, versioned aggregation facts by account/date/currency/dimensions. Never treat an
aggregate as the only financial evidence.

### webhookInbox and syncRuns

Inbox is append-only delivery intake with uniqueness and processing state. Accepted deliveries are
scheduled as `webhook.process` jobs; processing normalizes the immutable source snapshot and uses
the delivery/job key as the idempotency boundary. The `connection_sync_runs` table tracks
`initial`, `incremental`, and `reconcile` type, bounded JSON cursor, pages/items/deletions,
retry-after and redacted failure category/code, with `(account_id, connection_id, status,
updated_at, id)` indexing. A checkpoint is persisted only after the page's catalog/order effect;
retrying the same job resumes the stored cursor. Reconciliation assigns a run token to seen remote
orders and marks missing snapshots as remotely deleted without removing local evidence.

### auditEvents

Append-only actor/system event with account, action, target, result, redacted change summary,
correlation/causation IDs, IP/device summary where allowed, and timestamp.

## Data migrations

- Every normalized document carries a schema/normalization version.
- Online backfills are idempotent, resumable, account-bounded, rate-limited, and observable.
- Index creation is a deployment task with rollout and rollback notes.
- Raw snapshots permit re-normalization when field mappings or connector versions change.

## Retention

- Credential envelopes: until connection deletion, with key rotation.
- Raw source payloads: configurable and shorter-lived when possible.
- Canonical orders and legal documents: account/legal policy.
- Job item details: bounded operational period, then aggregate result only.
- Audit: policy-defined, tamper-evident, never silently edited.
- Signed URLs: minutes, not permanent.
