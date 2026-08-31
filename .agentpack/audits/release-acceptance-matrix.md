# Release acceptance matrix

Audit date: 2026-08-31  
Audited branch: `ops/t0814-certify-production-readiness-and-close-release-evide` from merged
`main` `897a14a`, with the release-gate and cross-platform CI fixes recorded by T0814. The final
commit and merge state are recorded in `.agentpack/results/T0814.md`.

This matrix distinguishes fresh local evidence from external launch approval. Every command below
was run from a clean T0814 worktree after `npm ci`; a command is a release
pass only when its process exit code was zero.

## Fresh local gates

| Area | Command / evidence | Result | Release interpretation |
| --- | --- | --- | --- |
| Agentpack doctor | `npm run agent:doctor` | PASS: Node 24.19.0, Git, npm run 10.15.0, main and 36-task pack detected | Runtime and worktree prerequisites are available |
| Agentpack graph | `npm run agent:validate` | PASS: 36 tasks, required files valid | No invalid definitions or dependency graph error |
| Frozen install | `npm ci` | PASS: 13 workspaces, lockfile unchanged | Reproducible dependency installation |
| Format | `npm run format:check` | PASS | Configured source, test, tooling, README and CI files are formatted |
| Lint/type boundaries | `npm run lint` and `npm run typecheck` | PASS | `lint` now builds workspace dependencies first; strict no-emit typecheck also passes |
| Build | `npm run build` / `npm run -r build` | PASS | API, web and packages build; Vite reports only the existing chunk-size advisory |
| Unit | `npm run test:unit` | PASS | All 12 active workspace test runners completed with zero failures |
| Integration | `npm run test:integration` | PASS: persistence 46, API 23 | SQLite migrations, repositories, jobs, files and HTTP boundaries pass |
| Connector contract | `npm run test:contract` and `npm run test:contract -- --filter woocommerce` | PASS | Read-only Woo pagination, normalization, security, products and catalog contracts pass |
| Security | `npm run test:security` | PASS: connector 4, persistence 46, API 5 | SSRF, credentials, files, sessions, jobs and template controls pass |
| Account isolation | `npm run test:tenant-isolation` | PASS: persistence 2, API 1 | Cross-account repository and API negative paths pass |
| Chaos/recovery | `npm run test:chaos` | PASS | Lease/retry/idempotency/replay and account-scoped recovery tests pass |
| Golden artifacts | `npm run test:golden` | PASS: exports 6, documents 7 | XLSX/CSV safety, PDF dimensions, Arabic font, QR/barcode, ZIP and deterministic output pass |
| Critical E2E | `npm run test:e2e:critical` | PASS: API regression 9 plus deterministic critical journey repeated 2 times | Registration, Woo fixtures, filtering, export, manual order, documents, analytics and restore journey pass |
| Browser E2E | `npm run test:e2e` | PASS: 14 UI and 9 API tests | Authenticated operator workspaces and critical UI flows pass |
| Accessibility | `npm run test:a11y` | PASS: 5 | Admin, analytics, orders, exports and documents have no automated Axe violations |
| Visual | `npm run test:visual` | PASS: 2 | Arabic orders and analytics baselines pass; platform-specific snapshots are reviewed on Windows |
| Performance | `npm run test:performance` | PASS | At 100k orders: list 181.93ms, filtered 342.84ms, search 486.42ms, selection 150.50ms, job round-trip 1.26ms p95; all budgets pass |
| Hostinger smoke | `npm run test:hostinger` | PASS | Production entrypoint served web, `/health` returned schema 20/connected, backup listed, restore dry-run validated |
| Backup/restore apply | `node apps/api/dist/db-cli.js` with temporary `WOO_OPS_DATA_DIR` for `migrate`, `backup`, `restore`, and `restore --apply` | PASS | Backup manifest, checksum validation, dry-run and validated replacement completed on an isolated temporary directory |
| Secret scan | `npm run security:scan` | PASS: 206 tracked text files | No detected credentials or secret material |
| Dependency audit | `npm run security:audit` | PASS: no known high vulnerabilities | Production dependency audit is clean |
| Migration repeat | `npm run db:migrate` twice on a fresh temporary data directory | PASS | Fresh creation and idempotent repeat both applied successfully |
| Diff hygiene | `git diff --check` | PASS | No whitespace errors |

## Release implementation reconciliation

- T0807–T0813 are complete and merged; jobs have a closed type catalog, account-derived worker
  contexts, leases, retries, progress, cancellation/dead-letter handling and operational APIs.
- T0813 moved analytics rebuilds and field-mapping backfills off the request lifetime and added
  account-scoped freshness/progress plus append-only cost overrides.
- T0814 changes the root lint gate so a clean checkout is valid without pre-existing package `dist`
  output, makes Playwright's web server command work on Windows and Linux, and expands CI into
  quality, Linux browser/accessibility, and Windows visual jobs.
- SQLite migration 20 is versioned and idempotent; `order_cost_overrides` is account/order scoped,
  indexed, append-only, and uses integer minor-unit strings.
- Generated document/export tests inspect bytes, checksums, physical PDF boxes, embedded Arabic
  fonts, formula-injection handling, ZIP paths and deterministic output. Hostinger smoke verifies the
  production process and private backup/restore dry-run path.

## Product release decision

The code is locally release-certified when T0814's evidence, completion state, merge, final board and
clean-main checks are all present. No P0/P1 local defect is known after the matrix above. The product
must still not claim live launch approval until the external inputs below are supplied and exercised.

## External launch checks (not code blockers)

1. Merchant-owned Woo read-only keys, authorized callback URL, webhook secret and an approved test
   store for live authorization, health, initial/incremental/reconciliation sync and webhook smoke.
2. Hostinger Node application, private writable data directory, environment secrets, process/Cron
   configuration, DNS and TLS ownership.
3. Owner decisions for product identity, supported POS/author plugin semantics, carrier export
   templates, retention, cost/profit policy, billing currency and support policy.
4. Jurisdiction-specific invoice numbering, tax wording, cancellation policy and legal approval.

No repository or test value fabricates these inputs. Local fixtures, fake Woo behavior and dry-run
backup validation cover all engineering work that does not require external authority.

## Final handoff checks

- `main` contains every validated recovery/release commit and has no uncommitted valuable work.
- The T0202 user-owned dirty worktree is preserved; no unrelated changes are reset or deleted.
- Agentpack has 36 completed tasks and no unexplained failed, in-progress or planned task.
- Migration, index, account isolation, read-only connector, money/time, idempotency, private-file and
  artifact evidence is linked from the T0814 result.
