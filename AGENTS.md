# Repository Agent Contract

These instructions apply to Codex, Claude, Gemini, and human contributors. More specific task
instructions may narrow this contract but may not weaken security, tenant isolation, data
direction, or quality gates.

## Mandatory read sequence

Before changing code, read:

1. `.agentpack/manifest.json`
2. `.agentpack/product/PRD.md`
3. `.agentpack/architecture/ARCHITECTURE.md`
4. `.agentpack/tasks/README.md`
5. The selected task and every file in its `references` list

Run `node .agentpack/scripts/agentpack.mjs validate` before starting.

## Task and worktree discipline

- Work on exactly one task ID per branch and per worktree.
- Start tasks through `agentpack.mjs task start <TASK_ID>` unless the user explicitly chooses a
  different workflow.
- Do not start a task while any dependency is incomplete.
- Do not silently expand task scope. Record a follow-up task or ADR when a new concern is found.
- Preserve unrelated user changes. Never reset, discard, or rewrite them.
- Use conventional commits containing the task ID, for example:
  `feat(orders): T0310 add canonical order schema`.
- Before handoff, run the task validation commands plus repository-wide affected checks.

## Immutable product invariants

- Platform connectors are read-only by construction. Connector interfaces must not expose remote
  order, stock, customer, or product mutation methods.
- `exported`, local workflow, assignments, tags, notes, saved views, and documents are local data.
- Manual orders have `syncPolicy=never` and `inventoryPolicy=ignore`.
- Every tenant-owned record and query must be scoped by `organizationId`.
- Never trust a client-provided `organizationId`; derive it from the authenticated membership.
- Money uses integer minor units plus ISO currency. Never use floating-point arithmetic.
- Dates persist in UTC while retaining source timezone and raw source timestamps where needed.
- Remote payloads are immutable diagnostic snapshots with configurable PII retention.
- A remote update must never overwrite local workflow or export history.

## Engineering rules

- TypeScript strict mode is required. Avoid `any`; use `unknown` plus validation at boundaries.
- Validate HTTP, webhook, queue, environment, and connector payloads with shared schemas.
- Keep controllers thin and domain/application logic framework-independent.
- Use repositories that require tenant context instead of calling Mongoose models from routes.
- Long operations run as idempotent jobs, not inside request/response lifetimes.
- Every job needs a deterministic idempotency key, retry policy, dead-letter behavior, and audit
  event.
- All list APIs use server-side cursor pagination, bounded limits, and explicit stable sorting.
- Exports and PDFs are generated from immutable snapshots and stored outside MongoDB.
- Logs must never contain Woo credentials, session tokens, full webhook bodies, or unnecessary PII.

## Required tests

- Unit tests for domain rules and calculations.
- Integration tests for repositories, jobs, and HTTP boundaries.
- Contract tests for WooCommerce fixtures and connector normalization.
- End-to-end tests for critical operator journeys.
- Tenant-isolation tests for every tenant-aware repository and API group.
- Golden-file or visual regression tests for XLSX, invoice PDF, and thermal output.
- Idempotency and replay tests for webhooks, exports, and bulk actions.

## Definition of done

A task is done only when its acceptance criteria pass, migrations/indexes and API docs are updated,
security and tenancy are tested, observability is present for failure paths, and the implementation
agent records evidence using `.agentpack/templates/task-result.md`.
