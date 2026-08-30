# Release acceptance matrix

Audit date: 2026-08-31  
Purpose: distinguish fresh evidence from old task claims and make the final release decision
repeatable. “Pass” below means the command was actually run on the audited main state; “gap” means
the command may pass while the required product path is still absent.

## Current gates

| Area | Command / evidence | Current result | Release interpretation |
| --- | --- | --- | --- |
| Agentpack doctor | `node .agentpack/scripts/agentpack.mjs doctor` | PASS | Windows pnpm detection repaired |
| Agentpack graph | `node .agentpack/scripts/agentpack.mjs validate` | PASS before T0806 graph; PASS after registry fix | Must remain PASS after each recovery task |
| Install | `pnpm.cmd install --frozen-lockfile` | PASS | Lockfile reproducible |
| Format/lint/types/build | `pnpm.cmd format:check`, `lint`, `typecheck`, `build` | PASS | No current quality-gate failure |
| Unit/integration/contract | `test:unit`, `test:integration`, `test:contract` | PASS | Existing slices are tested |
| Security/isolation | `test:security`, `test:tenant-isolation`, `security:scan`, `security:audit` | Existing security/isolation PASS; scan/audit not rerun in this audit yet | Re-run after every auth/connector/file change |
| Browser | `test:e2e`, `test:a11y`, `test:visual` | Existing e2e PASS; a11y/visual commands are separate release gates | Only four shipped workspaces are covered today |
| Critical journey | `pnpm test:e2e:critical` | Old T0803 fixture journey PASS | Must be extended to real job/connection/export/document routes |
| Performance | `pnpm test:performance` | Old T0803 synthetic repository benchmark PASS | Does not yet prove worker/sync/export/PDF throughput |
| Hostinger | `pnpm test:hostinger` | Old T0803 start/health/backup dry-run PASS | Must include queue drain/readiness after T0807 |
| Backup/restore | T0801 integration and CLI evidence | PASS for existing DB/private files | Re-run after schema migrations and batch files |
| Artifact integrity | export/document golden tests | PASS for in-memory/package slices | Must include actual private export/batch files and authenticated downloads |

## Product release blockers

| Blocker | Owner task | Exit evidence |
| --- | --- | --- |
| No real in-process job dispatcher/handlers | T0807 | Restart/retry/dead-letter tests and operation APIs show real effects |
| No connection/sync lifecycle | T0808 | Fixture sync creates/upserts catalog/orders/refunds through durable jobs and health is truthful |
| Canonical standard fields and advanced filters incomplete | T0809 | Field catalog/filters/facets/order detail/timeline tests and UI E2E |
| Export batches do not generate/download files | T0810 | Real XLSX/CSV private file checksum/download/mark-exported E2E |
| Batch PDF/ZIP/thermal workflow absent | T0811 | Real batch artifacts, dimensions, failures, retry and authenticated downloads |
| Admin/auth/operations surfaces incomplete | T0812/T0813 | Role, reset/session, member, settings, connection and operations isolation E2E |
| Analytics rebuild still blocks HTTP; no cost override command | T0813 | Durable rebuild progress, failure recovery and explainable override audit |
| Final documentation/evidence not refreshed after recovery | T0814 | Fresh all-gate matrix and clean merged main |

## External launch checks (not code blockers)

These remain pending only because they require authority or live infrastructure:

1. Merchant-owned Woo read-only keys, authorized callback URL, webhook secret and an approved test
   store for the live connector smoke.
2. Hostinger Node application, private writable data directory, environment secrets, process/cron
   configuration, DNS and TLS ownership.
3. Owner approval of product identity, supported POS/author plugin field semantics, carrier export
   templates, retention period, cost/profit policy, billing currency and support policy.
4. Jurisdiction-specific invoice numbering, tax wording, cancellation policy and legal approval.

No code task may manufacture any of these values. The final status can become “code-complete with
external launch checks pending” only after T0814 proves every local row and leaves only this list.

## Final clean-state checks

The final task must verify:

- `main` contains every recovery commit and has no uncommitted valuable work;
- no dirty orphaned worktree is removed; the known dirty T0202 worktree is preserved or explicitly
  reconciled by its owner;
- Agentpack has zero unexplained failed/in-progress/planned tasks;
- migrations pass on a fresh database and repeat on a current database without data loss;
- no P0/P1 finding remains for account scope, read-only direction, money/time, idempotency,
  private-file authorization, worker execution or generated artifacts;
- the final report links every result file and names the exact external inputs still required.

