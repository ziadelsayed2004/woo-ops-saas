# System Architecture

## Architectural style

Use a modular monolith with three deployable processes and shared domain packages:

```text
apps/web       React operator application
apps/api       Express HTTP, auth, webhooks, query APIs
apps/worker    Sync, bulk, export, PDF, aggregation jobs

packages/domain          Entities, value objects, policies, events
packages/application     Use cases and ports
packages/contracts       Zod schemas, API and queue contracts
packages/persistence     Mongoose repositories and indexes
packages/connectors      Connector SDK and adapters
packages/documents       Template, PDF, barcode, and print logic
packages/exports         Selection, profile, transform, and file logic
packages/analytics       Cost and aggregation logic
packages/observability   Logs, traces, metrics, audit helpers
packages/ui              Shared accessible UI components
```

Domain and application packages must not import Express, React, BullMQ, Mongoose, Woo clients, or
storage SDKs. Infrastructure packages implement application ports.

## Runtime topology

```text
Browser -> Web CDN
Browser -> API container -> MongoDB Atlas
                         -> Managed Redis/BullMQ -> Worker container
                         -> S3-compatible storage
WooCommerce -> API webhook endpoint -> durable inbox -> Worker
Worker -> WooCommerce REST API (read only)
Worker -> MongoDB / Redis / object storage
```

The API and worker are long-running containers. This avoids short execution limits for sync and
Chromium PDF work while still requiring no self-managed VPS.

## Bounded modules

### Identity and tenancy

Owns users, sessions, organizations, memberships, roles, permissions, entitlements, usage, and
security events.

### Connections and connectors

Owns authorization, encrypted credentials, capabilities, connection health, cursors, field
discovery, webhooks, polling, reconciliation, and normalization.

### Orders

Owns canonical order read models, manual orders, local workflow, tags, assignments, notes,
selection snapshots, and stale-local-artifact detection.

### Exports

Owns profiles, versions, transforms, validation, batches, files, per-order export history, and the
derived export state.

### Documents

Owns templates, safe tokens, sequences, immutable document snapshots, render jobs, PDF merging,
barcodes, labels, and print presets.

### Analytics

Owns effective-dated cost rules, cost snapshots, metric policy, daily facts, rebuilds, and
dashboards.

### Operations

Owns audit events, job inspection, dead letters, health, retention, storage cleanup, telemetry, and
administrative diagnostics.

## Connector SDK

The SDK is capability-based and deliberately contains no remote mutation port.

```ts
interface CommerceConnector {
  readonly platform: string;
  readonly capabilities: ConnectorCapabilities;

  authorize(input: AuthorizationInput): Promise<AuthorizationRedirect>;
  completeAuthorization(input: AuthorizationCallback): Promise<EncryptedCredentialInput>;
  checkHealth(context: ConnectorContext): Promise<ConnectionHealth>;
  discoverFields(context: ConnectorContext): AsyncIterable<DiscoveredField>;
  pullProducts(input: ProductPullRequest): AsyncIterable<RemotePage<unknown>>;
  pullOrders(input: OrderPullRequest): AsyncIterable<RemotePage<unknown>>;
  pullOrder(input: SingleOrderPullRequest): Promise<unknown | null>;
  verifyWebhook(input: RawWebhook): Promise<VerifiedWebhook>;
  normalizeProduct(input: NormalizationInput): NormalizedProduct;
  normalizeOrder(input: NormalizationInput): NormalizedOrder;
}
```

The interface must never gain `updateOrder`, `updateStatus`, `updateStock`, or an unrestricted HTTP
escape hatch. Connector-specific requests live behind the adapter and an outbound allowlist.

## Write and read models

Canonical orders are the durable operational source for this SaaS. Use focused write models for
manual order changes and local workflow, plus denormalized read fields for list filters. Raw remote
snapshots remain separate or bounded to prevent ordinary list queries from loading large metadata.

Analytics use rebuildable facts, not ad-hoc scans across complete order documents. Exports and
documents use immutable snapshots to remain reproducible after remote or manual edits.

## Tenant isolation

Every request creates a `TenantContext` from the authenticated server-side membership:

```ts
type TenantContext = {
  organizationId: OrganizationId;
  actorId: UserId;
  membershipId: MembershipId;
  permissions: ReadonlySet<Permission>;
  correlationId: string;
};
```

Repositories require this context in their constructor or method. Routes never accept a tenant ID
as authority. Cache keys, job payloads, object keys, search indexes, audit events, and idempotency
keys include the organization scope.

## Durable ingestion

Webhook handling is split:

1. Verify transport, size, origin policy, and signature.
2. Store a unique inbox record with raw-body checksum and delivery identity.
3. Return a bounded HTTP response.
4. Enqueue processing using the inbox ID.
5. Normalize and upsert in a transaction or retry-safe sequence.
6. Mark inbox outcome and emit internal events.

Polling and reconciliation use the same normalization use case as webhooks.

## Job contract

Every queued job includes:

- schema version
- organization ID
- actor/system identity
- connection or target ID
- idempotency key
- correlation and causation IDs
- bounded input references, not huge payloads
- attempt policy and deadline

Job handlers use lease-safe state transitions: queued, running, succeeded, partially-succeeded,
failed, cancelled, dead-lettered. A succeeded idempotency key returns the prior result.

## Selection snapshots

Bulk operations never send thousands of IDs from the browser. A selection is one of:

```ts
type Selection =
  | { mode: "explicit"; orderIds: OrderId[] }
  | {
      mode: "query";
      filter: ValidatedOrderFilter;
      sort: StableSort;
      excludedOrderIds: OrderId[];
      dataWatermark: Date;
      queryHash: string;
    };
```

The worker resolves pages with a stable `_id` tie-breaker and records the actual affected IDs or a
snapshot manifest in object storage.

## Money and time

Money is `{ amountMinor: bigint-compatible string or int64, currency: ISO-4217 }`. API contracts
serialize minor units as strings if values may exceed JavaScript safe integers. No calculation uses
binary floating point.

Persist canonical timestamps as UTC. Store remote local timestamp, remote GMT timestamp, store
timezone, and normalization version when source ambiguity matters.

## Files

MongoDB stores metadata only. File bytes live in object storage under an organization-scoped,
non-guessable key. Downloads require authorization and use short-lived signed URLs or an authorized
streaming endpoint. File records include content type, byte size, checksum, retention class, and
scan status.

## Consistency rules

- Unique source order: organization + connection + external order ID.
- Unique webhook inbox: organization + connection + remote delivery ID or fallback checksum key.
- Unique job result: organization + job type + idempotency key.
- Invoice sequence increments atomically and is never reused.
- Export success and per-order export history are committed consistently after the file checksum is
  known.
- Remote normalization updates use optimistic version checks and never replace local subdocuments.

## API versioning

Use `/api/v1`. Breaking contract changes create a new API version or an explicit compatibility
window. Queue payloads and persisted snapshots carry independent schema versions with migrators.

## Failure boundaries

- Woo outage: connection degrades, jobs back off, local reads continue.
- Redis outage: API reads continue; new long actions fail clearly or remain pending through an
  outbox, depending on task implementation.
- Worker outage: accepted durable jobs remain queued; UI exposes lag.
- Object storage outage: no export/document success is recorded without bytes and checksum.
- Mongo outage: API fails closed; webhooks return retryable status only after bounded attempts.
- Bad tenant mapping: quarantine event and alert; never guess another organization.

## Dependency direction

```text
web -> contracts
api -> application -> domain
worker -> application -> domain
persistence/connectors/documents/exports -> application ports + domain
```

Circular package dependencies fail CI.
