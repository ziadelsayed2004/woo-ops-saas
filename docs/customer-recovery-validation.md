# Customer follow-up report validation

## Delivered behavior

- Dedicated Customers tab with Arabic/English labels, local search, UTC date range, product filter,
  bounded cursor pages, order-detail links, freshness warning and private Excel download history.
- One candidate per trimmed case-insensitive email and connection. Failed/cancelled candidates
  are filtered first; a strictly later-created Processing/Completed order excludes a candidate
  regardless of the success's product/date. Empty emails and remote-deleted/manual orders are
  excluded. This is current status, not payment evidence or historical transition analysis.
- Separate durable report payload on the existing export dispatcher. Existing order-export code
  and local exported state are not used by the report. No connector or sync code changed.
- Atomic immutable snapshots, same-request idempotency, standard job retries/dead letters/replay,
  ownership checks, safe failure audit, role/CSRF protection and account-scoped private files.
- Render/compression uses a bounded worker thread (256 MB old-generation limit, 120-second timeout),
  existing XLSX generator and a report-only layout option. Normal order layout defaults unchanged.
- Two pending reports per account, 10,000 rows maximum without silent truncation, latest 20 reports
  retained in the visible history. Read APIs are limited to 100 rows; UI defaults to 50.
- Header fill remains light gray, names/phones/IDs are text, dates are typed UTC values with number
  formats, counts numeric and money exact decimal text with currency. Formula-like strings are
  escaped. The file has one RTL worksheet for Arabic with appropriate widths/wrapping/frozen header.
- A checksum is staged before file creation, allowing interrupted completion to reuse verified
  private bytes rather than generate conflicting ZIP timestamps on retry.

## Data and deployment

Schema 24 adds report metadata/snapshot tables and a partial account/connection/normalized-email/date
index. A schema-23 upgrade does not run projection backfill or rewrite existing orders; older upgrades
retain their prior behavior. A migration regression compares every existing order column before and
after upgrade, including intentionally missing projections. Existing owner reset cleans report rows
and its standard private-export directory; the connection and other accounts remain intact.

No production data was copied, reset, deleted, synchronized or marked exported during implementation.
All fixtures are synthetic. Publishing still creates the new schema/index through ordinary startup
migration. Reporting adds local CPU/storage work, not a claim of zero resource use; compression runs
off the HTTP event loop and the indexed query is measured with 100,000 synthetic orders.

## Checks

- Full build, lint, strict typecheck, formatting and separate-TSX/CSS checks pass.
- Full unit suite passes, including existing PDF/XLSX suites.
- Full repository integration: 70 persistence tests and 32 API tests pass.
- Full security suite and the 3-test tenant-isolation gate pass.
- Browser admin regression: 17 tests pass, including English report filters/export/history and
  Arabic narrow layout, error recovery and Latin digits. Two new tests rerun with screenshots.
- API E2E: all 11 files/journeys pass, including actual background report creation/download bytes,
  role/CSRF/account isolation, sheet headers, leading-zero phone, RTL view and unchanged export state.
- Hostinger smoke passes with schema 24, durable identity, backup and restore dry-run.
- Focused report effect tests verify real XLSX formula escaping, currency values, typed dates,
  cancellation, wrong-job ownership and retry after file write followed by persistence failure.
- Indexed 100k-order page repeatedly measured around 174–195 ms locally. EXPLAIN verifies the
  scoped success anti-join uses `orders_recovery_email_date`. This is not a production SLA.
- Migration, reset, invalid dates, cross-account/filter cursor reuse, same-time versus strictly
  later success, different-product success and history outside the candidate date range are covered.
- Oversized report fails before inserting any snapshot rows. Snapshot replay remains unchanged even
  if a successful order arrives after the snapshot.

## Visual/output review

Generated actual HTTP XLSX fixture under ignored `.cache/customer-recovery-qa/`. Artifact Tool imports,
inspects and renders its header/contact range. Native ExcelJS assertions independently verify exact
phone strings, `@` formats, cells, date objects, row count and light gray header. Artifact Tool previews
can coerce empty strings/leading-zero strings; previews are not used as proof of native Excel values.
The application exporter is retained rather than replaced with an artifact-only authoring dependency.

Browser screenshots under ignored `test-results/` were reviewed for readable layout, RTL and contained
table scrolling. No sample spreadsheet, screenshot, dependency cache or customer data is committed.

## Limitations

- Freshness is based on existing synchronization metadata. Even a recent sync does not prove full
  historical coverage; UI/file wording says local synchronized records. Data older than five minutes,
  failed or missing sync metadata raises a warning.
- Matching is deliberately email-only within each connection. Changing email, missing email, custom
  success statuses and historical refunded transitions are not inferred.
- XLSX amount remains exact text using the established money representation. Dates/counts are typed.
- Local tooling uses Node 24.19 while production declares Node 22.18. Browser checks use installed
  Chromium 1248 through an ignored 1243 cache junction. No runtime path/dependency change is committed.
- `npm ci --ignore-scripts` reports existing dependency advisories. Lockfile/dependencies are unchanged;
  the security test suite passing is not a claim that dependency audit advisories are resolved.
- User revoked prior AGENTS task instructions. Work is isolated in `feat/customer-recovery-report`;
  no unrelated pending Agentpack task was started or marked complete.
