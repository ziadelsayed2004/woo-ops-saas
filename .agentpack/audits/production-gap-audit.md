# Woo Ops production gap audit — superseded and closed

Audit date: 2026-08-31  
Audited release: T0814 worktree from `main` `897a14a`; final commit and merge are recorded in
`.agentpack/results/T0814.md`.

The original audit identified recovery work that was deliberately tracked instead of being hidden
behind old task evidence. T0806 created the recovery graph and T0807–T0813 implemented the local
gaps. T0814 reran the release matrix, reconciled documentation/CI, and records the final state.

## Recovery closure

| Former gap | Closure evidence | Status |
| --- | --- | --- |
| Durable dispatcher, handlers, queue operations | T0807 implementation, job-runner integration, chaos and critical E2E gates | Closed locally |
| Connection lifecycle and resumable Woo sync | T0808 implementation, Woo contract/security/sync tests and fixture E2E | Closed locally |
| Canonical fields, facets, typed filters and order operations | T0809 implementation, persistence/API isolation, orders and critical E2E | Closed locally |
| Real export files/profiles/downloads/exported state | T0810 implementation, export golden/API E2E and private-file security tests | Closed locally |
| Batch PDF/ZIP/thermal/label workflows | T0811 implementation, document golden/API E2E and artifact security tests | Closed locally |
| Auth, members, settings and operations administration | T0812/T0813 implementation, admin E2E/a11y and security/isolation gates | Closed locally |
| Async analytics, freshness and append-only cost overrides | T0813 implementation, analytics unit/integration/job and UI evidence | Closed locally |
| Final release evidence and clean-checkout gates | T0814 release matrix, CI/browser fixes, migration repeat and final handoff | Closed locally after completion/merge |

## Current implementation inventory

- Runtime is React/Vite + Express + SQLite WAL with private local files and one in-process durable
  job runner per merchant deployment.
- The API has session authentication, account roles, CSRF/origin checks, account-derived repository
  contexts, connection lifecycle/sync, canonical orders, local manual orders, filters/selections/
  bulk jobs, export/document jobs, analytics and administration operations.
- WooCommerce is a read-only REST v3 connector. Remote facts are immutable local snapshots; local
  workflow, export state/history, documents, costs, notes, tags and manual orders never write back.
- Long work is queued in SQLite with bounded payloads, deterministic idempotency, leases, progress,
  cancellation/retry/dead-letter behavior and account-scoped worker contexts.
- Generated XLSX/CSV/PDF/thermal/label files are private checksum-bound artifacts. Golden tests
  exercise formula injection, UTF-8/Arabic data, physical dimensions, embedded fonts, QR/barcode,
  ZIP safety, deterministic bytes and partial batch behavior.
- Migration 20 adds account-scoped append-only cost overrides; dates remain UTC and money remains
  integer minor units with explicit ISO currencies.

## Fresh release evidence

T0814's release-acceptance matrix records fresh passing output for frozen install, doctor/Agentpack,
format, clean-checkout lint, strict typecheck/build, unit/integration/contract/security/tenant/chaos,
critical and browser E2E, accessibility, visual, golden artifacts, performance, Hostinger
start/health/backup/restore dry-run, migration repeat, secret scan, dependency audit and diff
hygiene. No local test runner is a placeholder or no-op.

## External launch boundary

Only the following remain intentionally pending because they require authority outside the repository:

1. Merchant-owned Woo read-only keys, callback/webhook configuration and a real approved store.
2. Hostinger Node application, private data path, production secrets, Cron, DNS and TLS ownership.
3. Owner product decisions for identity, supported POS/author fields, carriers, retention, costs,
   currencies, support and billing.
4. Jurisdiction-specific invoice numbering, tax wording, cancellation policy and legal approval.

These are launch inputs, not implementation gaps. The repository contains only redacted fixtures,
fake-store behavior and dry-run validation; it does not fabricate credentials, legal approval or
deployment ownership.
