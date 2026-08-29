# Test Strategy

## Test layers

### Unit

Pure domain policies: money, totals, refunds, export state, stale snapshots, manual-order invariants,
permissions, cost rules, metric formulas, filter AST validation, and idempotency keys.

### Integration

Mongoose repositories with real Mongo behavior, indexes, transactions where used, Redis/BullMQ,
object storage, session persistence, API middleware, and worker state machines.

### Connector contract

Redacted Woo fixtures covering guests, variations, coupons, taxes, fees, multiple shipping lines,
refunds, deleted products, custom statuses, metadata shapes, currencies, timezones, POS-created
orders, Arabic data, pagination, and schema drift.

### End-to-end

- sign up/create organization/invite and role enforcement
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
- tenant-isolation attack suite
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

## Tenant isolation matrix

For every tenant API/repository/job/storage action:

- organization A cannot read B by ID
- A cannot mutate B by ID
- A cannot infer B through count/search/facet/error timing
- jobs cannot accept swapped tenant/target IDs
- cache keys do not collide
- signed file access cannot cross organization
- audit results stay scoped

## Performance fixtures

Generate synthetic tenants with skewed realistic distributions at 10k, 100k, and 1m orders.
Measure common list/filter/search queries, bulk resolution, initial sync throughput, reconciliation,
export memory, PDF concurrency, analytics rebuild, and index size.

## Quality gate commands

Once task T0001/T0002 establishes the workspace, the canonical root commands are:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:contract
pnpm test:e2e:critical
pnpm test:tenant-isolation
pnpm build
```

Tasks may add narrower commands but may not remove affected repository-wide gates.
