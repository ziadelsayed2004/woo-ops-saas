# Woo Ops production gap audit

Audit date: 2026-08-31  
Audited branch: `main` at `091869d` plus the T0806 recovery registry  
Audit method: read the accepted product, architecture, API, data-model, security, sync,
deployment and testing contracts; inspect the actual TypeScript source, migrations, routes,
package scripts, tests and all existing task evidence. A passing old task result is evidence for
the code it names, not proof that later contracts are implemented.

## Current baseline

The repository is a strict TypeScript pnpm workspace using Vite, React, Express and SQLite WAL.
The Agentpack doctor and validator pass, the existing 27 task results are recorded completed, and
the following fresh gates pass on the audited main commit:

| Gate | Result | Important boundary |
| --- | --- | --- |
| `pnpm.cmd install --frozen-lockfile` | PASS | 13 workspace projects, lockfile unchanged |
| `pnpm.cmd format:check` | PASS | Configured source/config/test paths |
| `pnpm.cmd lint` | PASS | 12 buildable workspace projects |
| `pnpm.cmd typecheck` | PASS | Build plus strict no-emit checks |
| `pnpm.cmd test:unit` | PASS | 3 analytics, 8 connector, 5 document, 4 export, 29 persistence, 2 API tests |
| `pnpm.cmd test:integration` | PASS | 29 persistence and 5 API integration tests |
| `pnpm.cmd test:contract` | PASS | 8 connector and 29 persistence contract tests |
| `pnpm.cmd test:security` | PASS | Connector, persistence and API security suites |
| `pnpm.cmd test:tenant-isolation` | PASS | Persistence and API account-isolation suites |
| `pnpm.cmd test:e2e` | PASS | 9 Playwright plus 5 API E2E tests |
| `node .agentpack/scripts/agentpack.mjs validate` | PASS before recovery additions | 27-task graph; T0806 adds the next graph |

The tests are meaningful for their implemented slices. Several release claims remain unproven
because the current API has no route or worker that can exercise them. Those gaps are listed below.

## Source inventory and confirmed structural gaps

### API surface

Implemented in `apps/api/src/index.ts`: authentication register/login/session/logout; account GET/PATCH;
audit list; order query/detail; manual order create/update; OAuth authorize/return; webhook intake;
selections; saved views; bulk persistence/preview/status; export profile/version and batch metadata;
export-state history; document template/preview/single-order generation/file download; analytics and
cost-rule routes; static web serving.

Documented but not implemented as HTTP use cases: connection list/detail/health/sync/reconcile/disable/
rotate/field catalog/mapping; order timeline/local workflow/tag/note/resync; export profile update,
version list/preview, batch download/retry; document batch/list ZIP; members/invitations/roles/
sessions/password reset/refresh; operations health/sync-runs/jobs/dead-letters/replay/usage; account
creation/activation for hosted mode. Direct `store.db` calls remain in controllers for account,
audit, OAuth state/callback and webhook connection lookup even though `SECURITY.md` prohibits that.

### Job and synchronization runtime

`packages/persistence` contains durable tables, leasing, retries, progress and bulk-item state, but
there is no in-process dispatcher, handler registry, startup drain, cron drain, shutdown handling or
job execution loop. A webhook is accepted and a `webhook.process` row is queued, but no code consumes
it. Bulk jobs, document jobs and export batches therefore stop at metadata/queued state. Analytics
rebuild currently performs the full rebuild synchronously inside the HTTP request.

### Connector and normalized data

`packages/connectors` provides a read-only Woo pull/normalization implementation and strong URL,
redirect, signature and schema checks. It does not yet expose a typed health/discovery port or a
credential decrypt/execution service, does not implement connection lifecycle APIs, and lacks a
retry/backoff/`Retry-After`/circuit policy. Order normalization stores a small normalized object and
raw source JSON but does not expose typed payment, shipping lines, fees, coupons, tax lines, POS,
author, tracking, channel or source-created timestamp fields as first-class query fields. Product
metadata is not merged into order-line snapshots.

### Persistence and query model

Migrations v1-v14 are inline and idempotent, with WAL/foreign keys, account predicates and useful
repositories. The current order query allowlist has only `orderNumber`, `externalOrderId`, remote/local
status, export state, origin, currency, connection, one date mapped to `remote_modified_at`, and
grand total. Search is a set of `LIKE` predicates over a few columns/raw normalized JSON; there is no
approved FTS index, facet endpoint, quantity/line/product/category/author/POS/payment/shipping/tag/
coupon/refund/exception filter, or source-created date column. There is no repository for connections,
members, operations metrics, document batches, ZIP manifests or export file download.

### Web and operator experience

`apps/web/src/App.tsx` currently exposes Orders, Manual orders, Documents and Analytics views. It has
limited search/status/column controls and does not provide an auth/login gate, Connections, Exports,
Settings, Members, Operations, filter builder, saved-view UI, row/cross-page selection, bulk progress,
export download, document batch/ZIP workflow or role-aware navigation. The existing Playwright suite
proves the four shipped views only.

### Security and operations

The security suites cover important isolation/SSRF/file/template cases. Remaining local hardening
includes schema validation for account settings, security headers/CSP baseline and rate limits beyond
login, password reset/session administration, strict callback credential transport handling, no direct
SQLite access from controllers, truthful readiness/queue/storage health, redacted operational views,
and worker permission re-checks. Live Woo authorization and Hostinger deployment credentials are
external checks, not reasons to fake local completion.

## Requirement mapping

Status values:

- **Implemented slice**: the named behavior exists and has current evidence, but may still have
  dependent gaps.
- **Partial**: the contract is represented or tested in one layer but the production path is absent.
- **Recovery task**: a local implementation is required and assigned below.
- **External launch check**: cannot be performed without merchant/hosting/legal authority.

| Requirement | Current evidence | Status / recovery |
| --- | --- | --- |
| FR-100 secure account identity and roles | `apps/api/src/auth.ts`; T0102/T0103 results; session/account predicates | Partial: member administration, password reset/change, session revocation and route-wide capability middleware are missing. T0812 |
| FR-200 Woo connection lifecycle | T0201 connector/OAuth tests; authorize and callback routes | Partial: no connection repository/list/health/disable/rotate UI/API; callback still receives credentials in query transport. T0808; live store test external |
| FR-210 initial/incremental/webhook/reconciliation sync | T0202-T0204 pull and persistence tests | Partial: no dispatcher, sync use case, cursor run orchestration, webhook consumer, overlap polling or reconciliation. T0807 + T0808 |
| FR-220 metadata/catalog field discovery | T0303 order metadata repository tests; T0203 catalog upsert tests | Partial: product/line/variation enrichment, mapping APIs/UI and backfill jobs absent. T0808 + T0813 |
| FR-300 search/filter/columns/facets | T0301 query compiler tests; limited T0302 grid | Partial: supported field coverage, FTS/facets, typed builder and saved-view UI absent. T0809 |
| FR-310 cross-page bulk operations | T0402 selection/job persistence tests | Partial: no worker execution or operator action UI/progress/retry download. T0807 + T0809 |
| FR-320 complete order details/timeline | T0302 detail E2E; normalized/raw snapshot fields | Partial: typed standard fields and timeline/local command APIs are absent. T0809 |
| FR-330 local manual orders | T0401 normalizer, API and E2E | Implemented slice: local invariants are strong; catalog picker, edit UI and full shared form remain. T0809 |
| FR-400 XLSX/CSV export | T0501 engine/golden tests and T0502 state | Partial: batches are metadata-only; no file job, private export storage/download/preview or UI. T0810 |
| FR-410 invoices/thermal/labels | T0601/T0602 PDF engine, template and single-file tests | Partial: no durable batch PDF/ZIP execution, immutable document batch manifest or complete print UI. T0811 |
| FR-500 explainable analytics/costs | T0701/T0702 formulas, facts and dashboard E2E | Partial: rebuild blocks HTTP, cost override UI/event path is absent, and operations freshness/jobs are absent. T0813 |
| FR-600 administration | Account PATCH/audit routes only | Partial: connections, members, settings UI, operations and field mapping administration absent. T0812 + T0813 |
| Read-only Woo direction | `ReadOnlyCommerceConnector`, connector security tests, T0802 | Implemented invariant; all recovery work must keep static no-mutation test. |
| Account isolation | repository/API isolation suites and account-first schema | Implemented slice; recovery tasks add tests for every new route/worker/storage path. |
| Money/time | BigInt/minor-unit and UTC tests | Implemented slice; new typed fields and exports must preserve it. |
| Idempotent durable work | persistence lease/idempotency tests | Partial: storage state exists, execution/effect handlers absent. T0807 |
| Private files/backups | T0602/T0801 and Hostinger smoke | Implemented slice for current documents/backups; export/batch manifests still T0810/T0811. |
| Arabic/English RTL/LTR | T0302/T0702/T0804 Playwright evidence | Partial: shipped views pass; auth/connections/exports/settings/operations need localization/a11y. T0813 |
| Hostinger single-process deployment | T0803 smoke and deployment guide | Partial: static start/backup passes, but real job drain/cron endpoint and operational health are missing. T0807/T0814 |
| Performance at 10k/100k | T0803 synthetic repository benchmark | Partial: benchmark bypasses real sync/export/document worker path. T0807/T0810/T0811 and final re-run T0814 |
| Legal invoice/tax/carrier policy | PRD product decisions section | External launch check; keep configurable and do not invent legal approval. |
| Live Woo credentials/store | no production credentials in repo by design | External launch check; fixture certification remains local work. |
| Hostinger account/DNS/TLS | no external account authority | External launch check. |

## Recovery graph

The following tasks were added to `registry.json` by T0806. All are single-worktree tasks. They are
phase-8 recovery tasks because they repair already-closed slices without pretending that the old
phase labels make them complete; dependencies are explicit and the board remains the authority.

| Task | Local gap closed | Depends on |
| --- | --- | --- |
| T0812 | Account administration, auth/security operations, truthful readiness | T0806 |
| T0807 | Durable dispatcher, handlers, queue operations APIs | T0806, T0812 |
| T0808 | Connection lifecycle, Woo health and full resumable sync | T0807 |
| T0809 | Canonical order completeness, advanced filters and operations UI | T0808 |
| T0810 | Real export jobs/files/downloads/profile UI | T0809 |
| T0811 | Batch documents, ZIP/PDF manifests and print operations | T0810 |
| T0813 | Async analytics, cost overrides and missing administration workspaces | T0811 |
| T0814 | Fresh release certification, matrices and final evidence | T0813 plus prior release tasks |

The only intentionally non-local checks are live authorization/deployment/owner/legal decisions.
Every other partial row is a blocking implementation or evidence task and must not be described as
complete until its task result contains fresh command output.

