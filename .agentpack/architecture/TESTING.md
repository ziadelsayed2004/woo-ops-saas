# Test Strategy

## Test layers

### Unit

Pure domain policies: money, totals, refunds, export state, stale snapshots, manual-order invariants,
permissions, cost rules, metric formulas, filter AST validation, and idempotency keys.

### Integration

SQLite repositories with real migrations, indexes, transactions where used, private file storage,
session persistence, API middleware, and in-process durable-job state machines.

### Connector contract

Redacted Woo fixtures covering guests, variations, coupons, taxes, fees, multiple shipping lines,
refunds, deleted products, custom statuses, metadata shapes, currencies, timezones, POS-created
orders, Arabic data, pagination, and schema drift.

### End-to-end

- sign up/create account/invite and role enforcement
- connect test Woo store and complete initial sync
- webhook update with local fields preserved
- advanced filter and saved view
- explicit and cross-page selection
- XLSX export and export-history state
- manual order with no platform request
- invoice PDF and thermal label
- analytics formula and cost snapshot
- dead-letter inspection/replay

### Non-functional

- load and soak tests
- account-isolation attack suite
- webhook replay and signature abuse
- SSRF and callback tests
- queue restart and duplicate-delivery chaos
- object-storage/PDF failure injection
- accessibility and RTL checks
- backup restore rehearsal

## Test data rules

- Never commit real credentials or unredacted production customer data.
- Fixture IDs and PII are synthetic.
- Keep raw request bytes when signature tests require exact encoding.
- Fixture files declare Woo/source version and expected canonical normalizer version.
- Golden files have explicit review and deterministic metadata stripping.

## PDF and thermal validation

- Render test PDFs to images and compare stable regions.
- Validate page boxes and exact physical dimensions.
- Verify embedded fonts, Arabic shaping, RTL, barcode/QR decode, page breaks, overflow, margins, and
  absent browser headers/footers.
- Test one, many, long-address, many-line, empty-optional-field, and mixed-language orders.

## XLSX/CSV validation

- Open generated workbooks programmatically.
- Assert sheet names, row counts, column order/types, formats, frozen headers, and text-preserved
  phones/SKUs.
- Test formula-injection strings, Arabic, delimiters, quotes, line breaks, large selections, and
  per-line row mode.
- File checksum and export-batch metadata must match stored bytes.

## Account isolation matrix

For every account API/repository/job/storage action:

- account A cannot read B by ID
- A cannot mutate B by ID
- A cannot infer B through count/search/facet/error timing
- jobs cannot accept swapped account/target IDs
- cache keys do not collide
- signed file access cannot cross account
- audit results stay scoped

## Performance fixtures

Generate synthetic accounts with skewed realistic distributions at 10k, 100k, and 1m orders.
Measure common list/filter/search queries, bulk resolution, initial sync throughput, reconciliation,
export memory, PDF concurrency, analytics rebuild, and index size.

## Quality gate commands

Once task T0001/T0002 establishes the workspace, the canonical root commands are:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:contract
npm run test:e2e:critical
npm run test:tenant-isolation
npm run build
```

The root workspace scripts use the repository tools in `tools/` to execute packages in deterministic
dependency-first order. Use `npm run test:unit -- --filter persistence` (or another workspace/test
alias) for a focused run; do not rely on npm's generic workspace ordering for these quality gates.

The release-readiness gate also runs the repeated critical journey, SQLite capacity checks, and a
production-style Hostinger start/health/backup smoke test:

```bash
npm run test:e2e:critical
npm run test:performance
npm run test:hostinger
```

`test:e2e:critical` builds the monorepo, runs the API E2E suite, and repeats the complete fixture
journey in isolated temporary data directories. `test:performance` seeds 10k and 100k synthetic
orders and enforces p95 budgets for list, filter, search, cross-page selection, and job round trips.
`test:hostinger` starts the built single Node process in production mode, checks `/health` and the
served web shell, then validates backup listing and restore dry-run behavior.

The security certification gate is:

```bash
npm run test:security
npm run test:tenant-isolation
npm run test:contract -- --filter woocommerce
npm run security:scan
npm run security:audit
```

The tenant-isolation runner exercises account-scoped repositories, selections, jobs, webhook
connection ownership, and API contexts. Connector certification covers synthetic Woo orders,
catalog pages, pagination, read-only GET behavior, SSRF/private-address rejection, redirect and
origin protection, strict webhook signatures, schema-drift quarantine, and deterministic replay.

Tasks may add narrower commands but may not remove affected repository-wide gates.
