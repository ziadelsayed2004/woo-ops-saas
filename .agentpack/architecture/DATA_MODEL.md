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
state. Sessions are hashed, revocable, rotated, and device-aware.

Indexes:

- unique normalized email
- unique account + user membership
- session hash and expiry TTL

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

### exportProfiles and exportProfileVersions

Mutable profile identity plus immutable versions. Version stores row mode, column sources,
transform pipeline, validation, filename expression, locale, and output type.

### exportBatches

Immutable execution record: selection snapshot, profile version, data watermark, order snapshot
manifest, result counts, file metadata/checksum, actor, state, errors, and timestamps.

### orderExportEvents

Append-only per-order history allowing reliable derived export state and unexport audit without
editing old export batches.

### documentTemplates and documentTemplateVersions

Safe template identity plus immutable HTML/CSS/token contract versions. No arbitrary remote script,
network fetch, or executable template expression.

### documentSequences

Atomic counter per approved sequence scope. Counter increments are irreversible; gaps are recorded
with reason rather than reused.

### documents

Immutable order snapshot, template version, sequence value, format, dimensions, storage file,
checksum, generated-by, timestamps, and supersession relationship.

### costRules and orderCostSnapshots

Effective-dated product/variation/shipping/payment/return cost rules. Calculation records the exact
rule version and inputs. Overrides are append-only events with actor and reason.

### dailyOrderFacts

Rebuildable, versioned aggregation facts by account/date/currency/dimensions. Never treat an
aggregate as the only financial evidence.

### webhookInbox and syncRuns

Inbox is append-only delivery intake with uniqueness and processing state. Sync runs track type,
cursor range, counts, lag, retries, errors, and completion.

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
