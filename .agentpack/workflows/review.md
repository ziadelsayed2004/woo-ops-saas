# Review Workflow

## Inputs

- task definition from registry
- task result evidence
- merge-base diff
- CI/test artifacts
- relevant PRD, architecture, ADR, API and data-model sections

## Review order

1. Scope and acceptance: no missing or silent expansion.
2. Product invariants: read-only connector and manual-order isolation.
3. Tenant isolation and authorization.
4. Data ownership, idempotency, concurrency, retries and failure recovery.
5. Money, currencies, refunds, timestamps and snapshots.
6. API/queue schema validation and compatibility.
7. Index/query/storage performance and bounded memory.
8. Secret/PII logging, SSRF, injection, template/file safety.
9. Tests: meaningful negative paths, not only happy snapshots.
10. UI accessibility, RTL, error/progress/partial states where applicable.
11. Migrations, config, observability, documentation and rollback.

## Finding levels

- Blocker: data loss, cross-tenant risk, secret leak, remote write, incorrect money/legal evidence,
  destructive migration, or missing required acceptance.
- Major: reliability, idempotency, compatibility, performance, authorization, or test gap likely to
  fail production.
- Minor: maintainability or user-experience issue with bounded impact.
- Suggestion: optional improvement outside definition of done.

Approve only when blocker/major findings are resolved and task evidence matches actual commands.
