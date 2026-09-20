# Synchronization and Connector Specification

## WooCommerce baseline

- Use `/wp-json/wc/v3` REST endpoints.
- Use the Woo application authorization endpoint with `scope=read`.
- Do not use the legacy REST API or direct WordPress/Woo database tables.
- Follow response pagination headers/links and enforce bounded concurrency.
- Treat Woo monetary values as decimal strings and normalize to minor units using store currency.
- Consume orders, products, variations, categories, tags, shipping classes, refunds, and approved
  metadata.
- Store the Woo and WordPress versions observed at connection health checks.

Official references:

- https://developer.woocommerce.com/docs/apis/rest-api/v3/
- https://developer.woocommerce.com/docs/apis/rest-api/authentication/
- https://developer.woocommerce.com/docs/apis/rest-api/v3/orders/
- https://developer.woocommerce.com/docs/apis/rest-api/v3/webhooks/

## Connection lifecycle

```text
draft -> authorizing -> active -> degraded -> disabled -> deleted-by-policy
                         |            |
                         +-- rotating-+
```

Authorization requirements:

- Canonicalize and validate store URL before redirect.
- HTTPS is required outside explicitly flagged local development.
- Resolve DNS and block loopback, link-local, private, metadata-service, and unsafe redirected
  destinations to prevent SSRF.
- State includes nonce, account, actor, canonical store hash, issued/expiry times, and PKCE-like
  binding where the flow permits.
- Callback endpoint accepts only the expected method/content type and a small body.
- Encrypt credentials immediately and remove plaintext references before further work.
- Validate returned store URL matches the approved canonical origin.

The Woo connector exposes only `GET` requests for system status, catalog, orders, and discovery.
Credentials are held as AES-256-GCM envelopes with a deployment key and are decrypted only inside
the worker boundary. Health checks record safe Woo/WordPress versions and capabilities; connector
errors are classified into auth, permission, network, rate, remote, schema, normalization,
persistence, or unknown categories.

## Initial sync phases

1. Store/system capability probe.
2. Shipping/payment reference data if accessible and needed.
3. Categories, tags, attributes, and shipping classes.
4. Products and variations.
5. Orders in ascending modification windows.
6. Refund enrichment and reconciliation.
7. Field catalog sample/frequency finalization.
8. Search/facet backfill.
9. Watermark verification and activation.

Each phase has a durable cursor, counters, checkpoint timestamp, source page identity, retry budget,
and error taxonomy. Initial sync may serve partial data with a clear coverage banner.

The current SQLite implementation stores these checkpoints in `connection_sync_runs` and mirrors
the latest cursor/counters on `connections`. Catalog and order pages are applied through
account/connection-owned repositories before the cursor advances. A failed durable job records a
redacted error and retry-after hint; rerunning the same job resumes the last successful page.

## Incremental strategy

- Poll using `modified_after` or the closest supported endpoint behavior.
- Keep a configurable overlap window to handle clock skew and same-timestamp ordering.
- Use remote ID plus modification/hash checks for dedupe.
- Advance a cursor only after every page effect is durable.
- Periodically query a wider lookback and compare counts/hashes.
- Re-fetch a single order when a verified webhook lacks a complete supported payload.
- The incremental endpoint uses the last modified order timestamp minus a bounded configurable
  overlap (five minutes by default) and orders by modification ascending.

## Webhook intake

- Capture exact raw bytes before JSON parsing for signature verification.
- Verify signature with constant-time comparison.
- Validate expected source/connection mapping.
- Limit body size and reject unsupported topics.
- Prefer Woo delivery ID for uniqueness; otherwise build a deterministic fallback from connection,
  topic, external entity ID, source modification time, and body checksum.
- Store the inbox entry before enqueueing.
- Repeated valid deliveries return the prior accepted result.
- Never log full payloads or signature secrets.

The public intake currently supports `order.created`, `order.updated`, and `order.deleted`.
Created/updated payloads are normalized after inbox persistence; deleted payloads mark the matching
local snapshot as remotely deleted. Product/catalog changes are obtained through read-only polling
until a dedicated catalog webhook effect is introduced.

## Normalization pipeline

```text
transport payload
 -> connector schema validation
 -> source DTO
 -> canonical normalization
 -> currency/time/phone/address normalization
 -> product and mapping enrichment
 -> deterministic source hash
 -> account-scoped upsert
 -> local stale-artifact evaluation
 -> internal domain events
```

Normalizer output is versioned. Given the same source snapshot, catalog snapshot, field mapping
version, and normalizer version, output must be deterministic.

## Local/remote merge policy

Remote-owned paths:

- remote status and timestamps
- customer/billing/shipping facts
- remote line, payment, tax, fee, shipping, coupon, and refund facts
- remote metadata and source snapshot

Local-owned paths:

- local status, assignee, tags, notes
- export history and summary
- document history and invoice sequence
- cost overrides and manual operational facts
- saved views and selections

The update use case writes remote-owned paths with an allowlist. Whole-document replacement is
forbidden.

## Products, authors, and POS

Woo order lines expose product/variation identity but do not guarantee category, author, or POS
semantics. The product sync enriches line snapshots with product categories and mapped fields.

Author and POS values may come from:

- product attributes
- standard/custom taxonomies
- order or line metadata
- `created_via`
- a known POS plugin field

The field mapper must support all of these without hardcoding one plugin. If a required field is not
REST-visible, an optional companion WordPress bridge may expose an allowlisted, read-only field.

The optional Woo Ops Export Status Bridge is the certified path for SkyVerge/WooCommerce Customer /
Order / Coupon Export's protected `_wc_customer_order_csv_export_is_exported` order metadata. It
registers only `GET /wp-json/wc/v3/woo-ops/export-status`, reuses Woo's consumer-key authentication,
requires a WooCommerce-capable user, accepts at most 100 explicit order IDs and returns no customer
or order content. The connector performs one bounded companion read per order page and overlays the
result before normalization. A missing, unauthorized or incompatible bridge leaves the standard Woo
snapshot unchanged, which is displayed as unavailable; local export history remains independent.

## Rate and failure handling

- Connection-specific concurrency and page size.
- Exponential backoff with jitter for transient errors.
- Respect `Retry-After` when present.
- Do not retry authentication, validation, or forbidden errors indefinitely.
- Circuit-break a failing connection while local reads remain available.
- Separate error categories: auth, permission, network, rate, remote 5xx, schema drift, mapping,
  normalization, persistence, and unknown.

## Deletion semantics

Remote deletion/trash never hard-deletes local operational evidence. Mark `remoteDeletedAt`, retain
documents/exports/audit, remove from default views if policy says so, and allow privileged
inspection. Account retention may later purge eligible data through a separately audited job.

## Connector certification

A connector is releasable only with:

- capability manifest
- authorization threat review
- fixture corpus with redacted standard and edge payloads
- schema validation and normalization contract tests
- pagination, retry, idempotency, timezone, currency, refund, variation, and metadata tests
- rate-limit behavior
- no remote mutation interface or escape hatch
- health and observability dashboards
