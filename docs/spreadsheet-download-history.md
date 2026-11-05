# Excel downloads and previous files

Clicking Export Excel on the exports page now queues the existing durable export job, saves its
private output, and downloads it automatically when the batch completes. The same downloader is
used by the orders and shipping-sheet actions. Selection is retained. No additional export job is
created when downloading a saved file again.

The Previous files button beside the export action opens a responsive Arabic/English dialog. It
shows filenames, creation dates, status, order/row counts and repeat downloads. Failed jobs retain
their retry action. Cursor pages show 20 entries at a time and reach files beyond the previous
100-entry list. Pending entries refresh only while the dialog is open. Automatic downloads poll
one batch with a capped backoff, for up to 10 minutes, rather than scanning the entire history.
If that wait expires, the job continues and its output remains accessible in Previous files.

## API

- `GET /api/v1/export-batches?limit=20&cursor=...` returns account-scoped `items`, `nextCursor`
  and `hasMore`. Limit defaults to 100 and is bounded to 1–100. The existing unpaginated callers
  retain their `items` response. Cursors use creation time and ID for stable descending order.
- `DELETE /api/v1/export-batches/:batchId` requires an authenticated operator and CSRF token.
  It removes a completed or failed entry from visible history and returns 204. It is idempotent.
  Active jobs return 409; other accounts receive 404; read-only members cannot remove entries.
- Existing single-batch status, download and retry endpoints remain in use. Downloads return the
  original stored bytes, without regenerating the spreadsheet.

## Data preservation

Schema 25 adds a nullable history-deletion timestamp and a partial index on visible exports.
Existing entries are visible immediately. Migration does not rewrite orders or start a sync.
Removing history does not delete export jobs, private files, snapshots, idempotency records or
order export events, and does not reverse an order's exported status. Authorized direct links
remain valid. This is history removal, not storage cleanup.

## Validation

Repository/API regressions cover stable paging, malformed cursors, role and account isolation,
CSRF, active-job rejection, idempotent removal, immutable export evidence, repeat downloads and
upgrading schema 24 without rewriting orders. Browser regressions cover queued-to-completed
automatic downloads, history across reloads, repeat download, removal, older pages, error recovery,
Arabic mobile layout, accessibility and retained order selections.

Local checks passed with Node 22.18.0: build/lint, strict typecheck, formatting, CSS separation,
170 unit tests, 104 integration tests, all 11 API end-to-end suites and the 34 affected browser
journeys (including focused reruns after updating the expected history UI and visual baseline).
Hostinger startup, health, backup validation and redeployment identity smoke tests pass at schema 25.
The full dependency audit still reports zero vulnerabilities. Production data was not used or reset.
