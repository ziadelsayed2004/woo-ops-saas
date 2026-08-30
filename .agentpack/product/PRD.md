# Product Requirements Document

## 1. Product summary

Woo Ops is a deployable order operations application for a merchant who needs a faster and more
capable workflow than the native WooCommerce admin. Each installation owns one merchant account;
the merchant connects any WooCommerce store, the application continuously imports commerce data,
and operators work from a normalized local copy optimized for search, filtering, bulk actions,
exports, documents, printing, and analytics.

The first connector is WooCommerce. The core domain and connector SDK must support future commerce
platforms without changing order-facing application modules.

## 2. Non-negotiable data direction

| Data | Source of truth | Allowed direction |
| --- | --- | --- |
| Remote orders, products, categories, refunds, payment and shipping facts | Commerce platform | Platform to SaaS |
| Remote order status | Commerce platform | Platform to SaaS |
| Export history and `exported` state | SaaS | Local only |
| Local workflow, assignee, tags, notes, saved views | SaaS | Local only |
| Invoices, labels, generated files | SaaS | Local only |
| Manual orders | SaaS | Local only; never inventory-aware remotely |
| Remote product, stock, customer, or order mutation | Not supported | Forbidden |

## 3. Personas

### Account owner

Connects stores, manages billing and security, controls members, defines invoice identity, export
profiles, mappings, and retention.

### Operations manager

Builds saved views, assigns work, runs bulk actions, monitors exports, handles sync exceptions, and
reviews performance.

### Order operator

Searches and filters orders, creates manual orders, exports selected orders, prints invoices and
thermal labels, and updates local workflow state.

### Accountant/analyst

Views financial reports, configures permitted cost inputs, downloads reports, and audits invoices
without changing commerce data.

### Read-only viewer

Can inspect allowed orders, documents, dashboards, and audit history.

## 4. Goals

- Connect a WooCommerce store without custom development for standard fields.
- Make every useful canonical order field searchable, filterable, selectable, and exportable.
- Discover Woo metadata and allow administrators to map custom fields into typed local facets.
- Support safe selection across pages and asynchronous actions on large result sets.
- Generate immutable A4 invoices, 80mm receipts, and 100x150mm shipping labels in bulk.
- Keep manual orders visually and operationally compatible with imported orders while preventing
  any remote sync or inventory side effect.
- Produce explainable sales, refund, shipping, cost, and contribution-profit analytics.
- Maintain a strict account boundary, immutable audit trails, and recoverable background jobs.
- Add a second platform through the connector SDK without rewriting order modules.

## 5. Out of scope for v1

- Writing order status, stock, products, or customers back to WooCommerce.
- Full warehouse inventory management or procurement.
- Purchasing shipping labels from carriers; v1 generates labels and carrier export files.
- Marketplace settlement reconciliation.
- Native mobile apps.
- Custom accounting jurisdiction compliance without an approved legal/tax specification.
- Running Chromium PDF generation inside short-lived edge functions.

## 6. Functional requirements

### FR-100 Local account identity

- Users authenticate through secure session-based authentication.
- Each deployment has one merchant account with local roles: owner, admin, operator, and viewer.
- Permissions are capability-based and enforced on API and job boundaries.
- A future hosted edition may add account switching without leaking cached or in-flight data.
- All sensitive operations write actor, account, request/job, target, before/after summary,
  timestamp, and correlation ID to an audit log.

### FR-200 WooCommerce connection

- User enters an HTTPS store URL and follows the Woo authorization flow with read scope.
- Callback state is single-use, short-lived, signed, and bound to user and account.
- Credentials are encrypted at rest and never returned after connection.
- Connection health exposes last success, last error category, permissions, Woo version, supported
  capabilities, webhook health, cursor, and lag.
- Disconnecting disables new ingestion but retains data according to account policy.
- Reconnect rotates credentials without creating a duplicate store.
- Standard integration uses Woo REST API v3; no legacy REST API and no direct WordPress database
  access.

### FR-210 Synchronization

- Initial import fetches products, variations, categories, tags, shipping classes, orders, and
  refunds with resumable cursors.
- Webhooks provide near-real-time order changes after HMAC verification.
- Incremental polling uses remote modification time with an overlap window.
- Periodic reconciliation finds missed events and remote deletions.
- Every event and fetch is idempotent.
- A unique source identity prevents duplicate imported orders.
- Remote updates change only the remote snapshot and normalized remote fields.
- Local workflow and export history survive every remote update.
- Orders changed after export receive a visible stale-export marker.
- Poison events enter a dead-letter queue with safe replay tooling.

### FR-220 Field discovery and mapping

- The application inventories encountered order, line, shipping, product, and variation metadata
  keys without exposing secret/private keys by default.
- An admin assigns a label and type: text, number, money, boolean, date, enum, or entity reference.
- Admins map fields to canonical facets such as author, POS location, salesperson, carrier, tracking
  number, or custom searchable field.
- Mapping changes trigger a controlled re-index/backfill job.
- Unknown metadata remains available in a permission-protected raw-data view with retention rules.
- Fields selected for filtering are indexed; arbitrary raw metadata is not automatically indexed.

### FR-300 Order list and search

- Server-side cursor pagination with stable sorting.
- Quick search supports order number, customer name, normalized phone, email, SKU, product name,
  tracking value, and configured custom fields.
- Filters support nested AND/OR groups and typed operators.
- Core filters include store, source, channel, POS, remote status, local status, export state,
  payment method/status, shipping method/carrier, shipping amount range, location, product,
  variation, SKU, category, author, tag, coupon, refund, dates, totals, quantity, and exception state.
- Users can choose, order, resize, pin, and hide columns.
- Saved views store filters, sort, columns, page size, and visibility; shared views require a
  permission.
- Query URLs are shareable inside the same account without embedding sensitive values.
- Counts and facets are computed asynchronously or from bounded aggregations when needed.

### FR-310 Cross-page selection and bulk actions

- Operators can select explicit rows or the entire current filtered result set.
- A selection snapshot stores query hash, exclusions, estimated count, and source data watermark.
- Before execution, the UI shows affected count, action parameters, permissions, and warnings.
- Actions are asynchronous, idempotent, cancellable before execution when safe, and auditable.
- Supported actions: set local status, assign, add/remove tag, mark export-ready, create export,
  generate invoice, generate thermal receipt, generate shipping label, print document batch,
  re-sync selected imported orders, and archive eligible local records.
- Remote platform mutations are never offered.
- Partial failures produce per-order results and retry only failed items.

### FR-320 Order details

- Display source identity, customer, billing, shipping, lines, discounts, taxes, fees, shipping,
  payment, refunds, remote status timeline, local workflow, documents, exports, sync events, and
  audit history.
- Clearly distinguish platform facts from local facts.
- Preserve original line and product snapshots even if the remote catalog changes later.
- PII visibility is permission-aware and access is audited for sensitive roles if configured.

### FR-330 Manual orders

- Use the same canonical form and presentation as imported orders.
- Manual order number comes from an account-scoped atomic sequence.
- Operator can use a catalog snapshot or create a free-form line.
- Line price, quantity, tax, discount, unit cost, and notes are explicit and validated.
- Customer, billing, shipping, payment, shipping method, and local status are editable.
- Invariant fields: `origin=manual`, `syncPolicy=never`, `inventoryPolicy=ignore`, no connection or
  external order ID.
- Manual orders participate in local exports, documents, printing, and analytics.
- Editing after document/export creation creates a stale marker; old snapshots remain immutable.

### FR-400 Export engine

- Export XLSX and CSV from explicit selection or a filtered snapshot.
- Profiles define filename, row mode, columns, labels, order, formatting, transforms, defaults, and
  required validation.
- Row modes: one row per order, line, package, or configurable carrier template.
- Phone, postcode, IDs, and SKU can be forced to text.
- Cells are protected from spreadsheet formula injection.
- Export generation occurs in an in-process durable job and streams output to private local files.
- An export batch stores query/selection snapshot, source watermarks, order snapshot hashes,
  profile version, actor, counts, errors, file checksum, and file version.
- `exported` is derived from successful batches, never a remote status.
- Re-export is allowed and increments history; unexport requires explicit permission and an audit
  reason without deleting old batches.

### FR-410 Document and print engine

- Versioned account templates support logo, colors, company identity, terms, dynamic fields,
  RTL/LTR, Arabic/English, and safe HTML/CSS tokens.
- A4/A5 invoice, 80mm receipt, and 100x150mm shipping label presets.
- Invoice numbering is atomic and configurable per account/store/year only after business and
  legal approval.
- Each generated document is an immutable snapshot with template version and SHA-256 checksum.
- Batch jobs can create a merged PDF or ZIP of individual PDFs.
- Thermal pages have exact physical dimensions, no browser header/footer, safe margins, barcode,
  QR, page breaks, and print preview.
- Failed pages do not invalidate successful documents; job results identify failures.
- Document access uses expiring signed URLs and authorization checks.

### FR-500 Analytics and costs

- Report Woo-only, manual-only, store-specific, and combined results.
- Metrics separate gross sales, discounts, net merchandise sales, shipping collected, tax,
  refunds, collected revenue, COGS, actual shipping cost, payment fees, return cost, and
  contribution profit.
- Cost rules are effective-dated; order lines retain the cost snapshot used for calculation.
- Operators can override costs with reason and permission.
- Daily aggregate facts can be rebuilt from immutable normalized orders.
- Dimensions include date, store, platform, channel, POS, status, export state, shipping method,
  product, variation, category, author, payment method, and location.
- Every number provides its formula and excluded statuses.
- Multi-currency analytics never combine currencies without an explicit exchange-rate snapshot.

### FR-600 Administration

- Store connections and health.
- Members, roles, sessions, and security events.
- Field catalog and mappings.
- Saved export profiles and document templates.
- Local workflow states, tags, and assignment rules.
- Cost rules and metric policies.
- Data retention, timezone, locale, currency, invoice identity, and sequence policies.
- Usage, queue health, failed jobs, dead letters, and audit exports.

## 7. Filter operator contract

| Type | Operators |
| --- | --- |
| Text | equals, not-equals, contains, starts-with, is-empty, is-not-empty, in |
| Number/money | equals, greater-than, greater-or-equal, less-than, less-or-equal, between |
| Date | on, before, after, between, relative-range, is-empty |
| Enum/entity | is-any-of, is-none-of, is-empty |
| Boolean | is-true, is-false |
| Collection | contains-any, contains-all, contains-none |

All operators are validated against the server-owned field catalog. Clients cannot submit raw
SQL fragments, JavaScript expressions, field paths, or regular expressions.

## 8. Non-functional requirements

### Performance

- P95 cached/supported order list request under 700ms at 100k orders per account.
- P95 order detail request under 500ms excluding file transfer.
- Common search result begins rendering within 1.5 seconds.
- Bulk actions accept the request within 500ms and continue asynchronously.
- Imports are resumable and bounded; no request pulls all Woo pages into memory.

### Reliability

- At-least-once delivery with idempotent effects.
- No data loss from process restart during sync, export, or document jobs.
- Recoverable dead-letter workflow and replay audit.
- Reconciliation catches missed webhooks within the configured service window.
- Exports and documents remain reproducible from stored snapshots.

### Security and privacy

- Account isolation at route, service, repository, jobs, storage, and search boundaries.
- Encryption in transit and application-layer encryption for connector credentials.
- Session rotation, CSRF protection, origin checks, rate limiting, and secure cookie defaults.
- Private filesystem permissions and time-limited signed file URLs.
- Configurable PII retention and redacted logs.
- Dependency, secret, and container scanning in CI.

### Accessibility and localization

- WCAG 2.2 AA target for operator interfaces.
- Complete keyboard operation for data grid and bulk action workflows.
- RTL/LTR layouts and Arabic/English copy architecture.
- Locale-aware dates and numbers without changing persisted canonical values.

## 9. Success metrics

- More than 99.9% of accepted webhook deliveries produce exactly one normalized effect.
- Initial sync can resume after interruption without duplicating orders.
- Zero cross-account access in automated isolation suites.
- An operator can filter, select across pages, export, and print without opening Woo admin.
- Standard store connection completes without developer intervention.
- At least 95% of supported standard order fields are available to column and export builders.
- The second connector requires only SDK adapter, mapping, fixtures, and capability declaration,
  with no order-module rewrite.

## 10. Release slices

### Foundation release

Tenancy, authentication, connector SDK, Woo authorization, product/order/refund sync, webhook,
order grid, order detail, and operational audit.

### Operations release

Field mapping, saved views, cross-page selection, bulk engine, export profiles, exported history,
manual orders, invoice PDF, thermal printing, and labels.

### Intelligence release

Cost rules, analytics facts, dashboards, scheduled exports, entitlements, mature observability,
retention, security hardening, and a second connector proof.

## 11. Product decisions still requiring owner approval

- Product name, visual identity, supported locales, and initial billing currency.
- Exact Woo POS and author plugins used by pilot stores.
- Carrier templates and whether carrier API label purchase enters a later release.
- Invoice jurisdiction, legal numbering, tax language, and cancellation rules.
- Contribution-profit formula and approved cost sources.
- Plan limits, trial policy, data retention, and customer support model.
