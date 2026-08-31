# WooCommerce connector certification matrix

Audit date: 2026-08-31  
Connector under review: `packages/connectors/src/woocommerce.ts`  
Direction invariant: pull/health/discovery/webhook verification only. No remote order, product,
customer, stock or status mutation is supported.

Official baseline references recorded by the architecture contract:

- <https://developer.woocommerce.com/docs/apis/rest-api/v3/>
- <https://developer.woocommerce.com/docs/apis/rest-api/authentication/>
- <https://developer.woocommerce.com/docs/apis/rest-api/v3/orders/>
- <https://developer.woocommerce.com/docs/apis/rest-api/v3/webhooks/>

## Local certification

| Capability / threat | Expected contract | Current evidence | Result |
| --- | --- | --- | --- |
| REST version | `/wp-json/wc/v3`; no legacy REST or direct DB | `WooCommerceConnector` paths and connector contract tests | PASS |
| Authorization | Woo application authorization with `scope=read` | OAuth URL/callback implementation, encrypted credential integration and API E2E | PASS locally; live callback remains external |
| Credential storage | AES-256-GCM envelope; secrets absent from logs/jobs/responses | Credential lifecycle and security tests; operation responses redact payloads | PASS locally |
| Store URL/SSRF | HTTPS, public DNS, no private/special IP, safe origin | URL, DNS, redirect and origin security tests | PASS |
| HTTP method surface | Explicit GET only; no arbitrary HTTP escape hatch | Read-only connector interface and method/security tests | PASS |
| Pagination/checkpoints | Bounded pages, resumable cursors, durable effect before advance | Woo page/product tests plus sync-run integration and critical E2E | PASS |
| Rate/failure handling | Classify 429/5xx/network/auth/schema and bound retries | Connector classification and durable job retry/dead-letter tests | PASS |
| Health | Safe Woo/WordPress versions, capabilities, lag and error status | Connection health route, operations health and Hostinger smoke | PASS locally |
| Products/variations/taxonomies | Deterministic account/connection snapshots and deletion markers | Catalog contract/integration tests and sync E2E | PASS |
| Standard orders | Customer/address/line/coupon/tax/fee/payment/shipping/channel/POS facts | Normalization, canonical projection, order detail/filter and critical E2E | PASS for supported fields |
| Refunds | IDs, amounts, reasons, dates and allocations remain source facts | Woo order contract and persistence sync tests | PASS for supported payloads |
| Currency/time | Decimal source values to minor units; UTC plus source timezone | Connector normalization and analytics tests | PASS |
| Schema drift | Invalid payloads quarantined, never treated as valid orders | `validateWooOrder()` contract/security tests | PASS |
| Webhook intake | Raw bytes/HMAC, bounded body/topic, owner binding, replay idempotency | Webhook security/integration/E2E tests | PASS |
| Delivery identity | Woo delivery ID or deterministic fallback; topic allowlist | Inbox uniqueness and accepted-topic tests | PASS |
| Incremental/reconciliation | Overlap window, durable checkpoints, missed-event/deletion recovery | Sync lifecycle integration and critical fixture journey | PASS locally |
| Metadata and mappings | Safe catalog, typed mapping/backfill, private raw data protected | Metadata/mapping persistence tests, backfill job and admin E2E | PASS for approved fields |
| Observability | Redacted categories, lag/counters, jobs and dead letters | Operations routes, job runner tests, health smoke | PASS |
| No-mutation certification | Static surface plus negative requests | Connector security tests and source review | PASS; no remote write port |

## Fixture and artifact evidence

The checked-in redacted fixtures and deterministic fake Woo flow cover Arabic/mixed-language data,
guest/registered customers, variations, empty SKU, discounts, taxes/fees, multiple shipping lines,
refunds, custom status/POS/author/carrier metadata, currencies/timezones, pagination, 429/5xx and
schema drift, duplicate webhooks, deletions, redirect/origin rejection, and replay behavior. The
fresh commands `pnpm test:contract`, `pnpm test:security`, `pnpm test:e2e:critical`, and
`pnpm test:chaos` pass in the T0814 evidence.

## External certification boundary

No real store or credentials are committed or invented. An authorized owner must perform one live
smoke after deployment using read-only Woo keys and verify authorization, health, initial/incremental/
reconciliation sync, webhook delivery, and the absence of remote mutation. Until then this connector
is locally code-certified and fixture-certified, not live-certified.
