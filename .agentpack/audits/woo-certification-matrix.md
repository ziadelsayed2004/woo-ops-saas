# WooCommerce connector certification matrix

Audit date: 2026-08-31  
Connector under review: `packages/connectors/src/woocommerce.ts`  
Direction invariant: GET/pull/health/discovery/normalization/webhook verification only. No remote
order, product, customer, stock or status mutation may be added.

Official baseline references recorded by the architecture contract:

- <https://developer.woocommerce.com/docs/apis/rest-api/v3/>
- <https://developer.woocommerce.com/docs/apis/rest-api/authentication/>
- <https://developer.woocommerce.com/docs/apis/rest-api/v3/orders/>
- <https://developer.woocommerce.com/docs/apis/rest-api/v3/webhooks/>

| Capability / threat | Expected contract | Current evidence | Result / task |
| --- | --- | --- | --- |
| REST version | Use `/wp-json/wc/v3`; never legacy REST or direct DB | `WooCommerceConnector` constructs v3 paths; connector tests inspect requests | PASS for current pull slice |
| Authorization | Woo application authorization with explicit `scope=read` | `createAuthorizationUrl`, T0201/T0802 tests | PASS locally; live store callback is external |
| Credential storage | AES-256-GCM envelope; plaintext absent from logs/jobs/responses | `encryptCredentialEnvelope`, callback storage and security tests | Partial: decrypt/execution boundary and rotation API are T0808 |
| Store URL/SSRF | HTTPS, public DNS, no private/special IP, no unsafe redirects/origin changes | `assertPublicStoreUrl`, request security tests | PASS for covered paths; re-check every new health/sync request in T0808 |
| HTTP method surface | Explicit GET only; no raw/unrestricted request escape hatch | connector interface and `requestPage` | PASS invariant; T0808 must preserve static mutation test |
| Pagination | bounded page size, page cursor, total pages/links, resumable checkpoint | pull tests support `startPage` and `x-wp-totalpages` | Partial: Link/edge cursor handling and durable per-kind runs are T0808 |
| Rate limits | classify 429, respect `Retry-After`, bounded exponential backoff and circuit state | 429 classification test exists | Partial: retry policy and health degradation are T0808 |
| Health | Woo/WordPress version, capabilities, permissions, last success/error, lag | no typed health port or API route | Missing: T0808 |
| Products/variations | normalize product and variation snapshots, deterministic identity, deletion | T0203 catalog tests and persistence upsert | Implemented slice; sync orchestration and order-line enrichment T0808 |
| Taxonomies | categories, tags, shipping classes and approved metadata | T0203 normalized catalog tests | Implemented slice; catalog API/backfill UI T0808/T0813 |
| Standard orders | customer, addresses, lines, coupon, tax, fee, payment, shipping, channel, POS/plugin metadata | `normalizeWooOrder` handles basic amount/date/customer/address/lines/refunds and stores raw JSON | Partial: typed canonical expansion T0809 |
| Refunds | normalize IDs, amounts, reasons, dates, line allocations idempotently | T0204 refund persistence tests | Partial: orchestration/reconciliation and typed allocations T0808/T0809 |
| Currency/time | decimal strings to minor units, UTC with raw/source timezone as needed | `decimalToMinorUnits` and connector tests | PASS for covered basic fields; expansion must preserve T0809 invariant |
| Schema drift | invalid payload quarantined, not treated as valid order | `validateWooOrder`, security test | PASS for current validator; certification corpus expands T0808 |
| Webhook raw verification | verify bytes/HMAC before parsing, bounded body/topic, owner binding and replay idempotency | API intake + `acceptWebhook`, T0202/T0802 tests | Intake PASS; consumer/normalization/replay effect T0807/T0808 |
| Webhook delivery IDs | delivery ID preferred, deterministic fallback, topic allowlist | fallback exists; arbitrary topic currently accepted into inbox | Partial: topic policy and dead-letter consumer T0807/T0808 |
| Incremental sync | modified overlap window, checkpoint after durable effects, missed-event reconciliation | no sync use case/route | Missing: T0808 |
| Remote deletion | mark deleted, preserve local evidence, remove only from default views | `markRemoteOrderDeleted`/catalog marker | Implemented slice; reconciliation runner T0808 |
| Metadata | order/line/product/variation scope, sensitivity, typed mapping/backfill | order `meta_data` discovery only | Partial: T0808/T0813 |
| Observability | redacted categories, lag/counters, sync runs, failures and dead letters | persistence fields exist for catalog/order runs but no API/worker | Missing: T0807/T0808 |
| No mutation certification | static scan plus negative tests for route/interface/request method | existing T0802 tests | Must be rerun after every connector change and in T0814 |

## Fixture corpus required for completion

T0808 must check in redacted deterministic fixtures for: guest and registered customers; Arabic and
mixed-language addresses; multiple lines/variations; empty SKU; coupons/discounts; tax and fee lines;
multiple shipping lines; refunds with allocation; custom statuses; POS-created orders; author and
carrier/tracking metadata; multiple currencies/timezones; pagination boundaries; 429 with
`Retry-After`; 5xx/network timeout; deleted records; malformed/schema-drift payloads; duplicate
webhook deliveries; and origin/redirect rejection.

## External certification boundary

No real store or credentials may be committed or invented. A final live-store smoke must be run by an
authorized owner after deployment using read-only Woo keys and must verify authorization, health,
initial sync, webhook delivery, incremental polling and no remote mutation. Until then the connector
is locally code-certified with fixture evidence, not live-certified.

