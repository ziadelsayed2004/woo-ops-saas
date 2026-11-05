# Customer follow-up Excel files

The automatic download and Previous files dialog now apply to **Customers → Customer follow-up**.
This corrects the earlier implementation, which placed these controls in the order export workflow.

- Export follow-up Excel still creates the existing immutable report through the durable export
  runner. It also polls the single report and downloads the saved file when complete. Filter inputs
  remain unchanged. The export button stays busy while preparing the report.
- Previous files is beside that export button and reads customer report history only. The bottom
  history list is replaced by a responsive dialog with names, dates, status, customer count,
  pagination, repeat downloads and confirmation before removing completed/failed entries.
- Each source keeps its existing private download endpoint. Reusing the dialog does not put
  follow-up reports into order export history or change the eligibility rule for follow-up customers.
- No report history is loaded until the operator opens the dialog. Pending visible reports refresh
  every 3 seconds; the single automatic download uses the existing capped backoff and 10-minute wait.
  Closing the dialog does not cancel the durable report job.

## API and data

- `GET /api/v1/customer-recovery/reports?limit=20&cursor=...` returns `items`, `nextCursor`, `hasMore`.
  Pages are bounded to 1–100 records with stable descending creation-time/ID ordering.
- `GET /api/v1/customer-recovery/reports/:reportId` returns the public report metadata and current
  durable job status. It does not expose private filesystem paths.
- `DELETE /api/v1/customer-recovery/reports/:reportId` requires an operator and CSRF token, returns
  204, and is idempotent. Another account receives 404; queued/running reports return 409.
- Schema 26 adds a nullable history-deletion timestamp and a partial account/date index. Existing
  reports stay visible. No orders are rewritten and no synchronization is triggered by migration.
- Removing a history entry preserves its private file, snapshot, job and idempotency record. It does
  not change customer data, order workflow or export status. Existing authorized download URLs still
  work; this action removes history rather than reclaiming disk space.

## Validation

Tests cover the actual customer follow-up screen: preparing-to-completed automatic download, repeat
download, history deletion, count labels, Arabic mobile layout and Latin digits. Repository/API tests
cover older pages beyond 20 reports, invalid cursors, CSRF, account/role isolation, active jobs,
idempotent removal, unchanged snapshots/orders and upgrading schema 25 with a saved report.

Passed locally with Node 22.18.0: full build/lint, strict typecheck, formatting and CSS separation,
172 unit tests, 106 integration tests, all 11 API end-to-end suites, and all 57 browser tests.
Desktop and Arabic mobile screenshots were reviewed in the customer follow-up screen itself.
Hostinger startup, backup validation and redeployment identity smoke tests pass at schema 26.
The dependency audit reports zero vulnerabilities. No production records were modified for testing.
