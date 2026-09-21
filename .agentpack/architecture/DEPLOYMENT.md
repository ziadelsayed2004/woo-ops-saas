# Deployment and Operations

## Local and Hostinger profile

Build the web app with Vite and run one Node/Express process. Configure a private writable
`WOO_OPS_DATA_DIR` containing the SQLite file, generated documents, exports and backups. The process
must expose `/health`, serve the built web assets (or use `WOO_OPS_WEB_DIST_DIR` when the hosting
working directory is different), and use environment-provided session/encryption secrets.
No external database, Redis, or external worker is required.

```text
npm run build
npm run start --workspace=@woo-ops/api
```

Hostinger uses Node.js 22.x and its application manager with `apps/api/dist/index.js` as the entry
file from the repository root. Set the build command to `npm run build` and output directory to `.`.
Hostinger installs production dependencies automatically before this command; TypeScript, Vite and
the type packages required to compile the deployable application are intentionally production build
dependencies. Browser-test and formatting tools remain development-only. Persistence uses Node's
built-in `node:sqlite`, with no node-gyp/Python/GLIBC-specific addon. The application opens SQLite and applies
migrations during startup, so a separate build-time migration is not required. Keep
`WOO_OPS_DATA_DIR` outside the public web root. HTTP requests remain bounded;
long work is durable and resumed from SQLite.

HTML-to-PDF generation uses the self-contained Sparticuz Chromium runtime on Linux so Hostinger does
not need root access or Playwright system packages such as `libatk-bridge`. Local Windows and macOS
development use Playwright's managed Chromium. The root postinstall readiness check launches the same
provider used by document jobs and renders a smoke PDF before deployment proceeds. Linux extracts the
browser into the application-owned executable cache at `.cache/woo-ops-browser` instead of the shared
`/tmp` mount, which Hostinger configures as `noexec`. Set `WOO_OPS_BROWSER_CACHE_DIR` to an absolute,
private, executable filesystem path only when the default application directory is unsuitable.

`npm ci` can currently report deprecation notices for `inflight`, `glob@7`, `rimraf@2`,
`fstream`, and `lodash.isequal`; these are transitive dependencies of the latest ExcelJS 4.4
release, not the document browser. Treat a non-zero postinstall/readiness exit as actionable, and
track the ExcelJS notices separately until its upstream dependency graph is replaced or updated.

Reproduce Hostinger's install/build boundary before deployment:

```text
npm ci --omit=dev
npm run build
```

Required production environment:

```text
NODE_ENV=production
WOO_OPS_DATA_DIR=/home/<account>/private/woo-ops-data
WOO_OPS_DATABASE=/home/<account>/private/woo-ops-data/woo-ops.sqlite
SESSION_SECRET=<at least 32 random bytes>
TOKEN_ENCRYPTION_KEY=<base64 encoded 32-byte key>
WEB_PUBLIC_URL=https://orders.example.com
API_PUBLIC_URL=https://orders.example.com
```

Never commit these values, place the data directory under `public_html`, or expose its directory
listing. The Node process serves `/` from `apps/web/dist` and leaves `/api/*` and `/health` under
Express API routing.

Release smoke commands, executed after build and migration, are:

```text
npm run test:hostinger
npm run test:e2e:critical
npm run test:performance
```

`test:hostinger` starts the production API entrypoint, verifies `/` and `/health`, creates a backup,
lists it, and performs a restore dry-run. `test:e2e:critical` runs the API regression suite and repeats
the fixture-only registration, Woo sync, filtering, export, manual order, documents, analytics and
restore journey. `test:performance` seeds 10k and 100k synthetic orders and fails if p95 list/filter,
search, selection or job round-trip budgets exceed the documented limits.

## Backups

Backups create a consistent SQLite snapshot, copy private generated files, write a manifest with
application/schema versions, byte sizes and SHA-256 checksums, and prune only versions beyond the
configured retention. Restore supports dry-run validation before replacing live data. The commands
are safe for Hostinger Cron because they use bounded file/byte limits and never expose the data
directory through Express:

```text
npm run db:backup
npm run db:maintenance -- --retention 7 --max-files 10000
npm run db:backup -- --retention 7 --max-bytes 1073741824
npm run db:restore -- backup-<id>                 # validate only
npm run db:restore -- backup-<id> --apply         # replace after validation
```

Restore validates the manifest, every checksum, SQLite integrity, schema version and foreign keys
before it stages anything. Replacement happens only after validation; a failed replacement rolls
the database and private files back to their previous paths. Keep the data directory private and
run restore while the Node process is stopped so no open SQLite handle can race the replacement.

## Release gates

Run agentpack doctor/validation, `npm ci`, format, lint, typecheck, unit/integration/contract,
security, tenant-isolation, chaos/recovery, golden artifact, critical E2E, full browser E2E/accessibility, visual,
performance, Hostinger smoke, secret scan, dependency audit, build and `git diff --check`. The root
`lint` script builds workspace packages first so it passes from a clean checkout before `typecheck`
or a previous build has populated dependent `dist` directories. CI mirrors these gates in a quality
job, a Linux browser job (with an explicit Chromium install), and a Windows visual-baseline job.
Visual snapshots are platform-specific and must be reviewed on the runner that owns their baseline.
Never expose the data directory or credentials through static serving, logs, errors or client bundles.

## Capacity baseline and operating limits

The checked-in benchmark uses Node 22.18 with built-in `node:sqlite` on Windows, SQLite WAL, 25 warm
iterations, a 100-row page, and synthetic order payloads. The enforced p95 budgets are:

| Operation | Budget |
| --- | ---: |
| order list | 700 ms |
| typed filtered list | 700 ms |
| text search | 1,500 ms |
| cross-page selection page | 700 ms |
| durable job enqueue/claim/complete | 250 ms |

The observed 100k-order baseline is 192.63 ms list, 337.71 ms filtered list, 466.15 ms search,
165.44 ms selection, and 31.38 ms job round-trip p95. These are a release regression budget, not a
promise of Hostinger capacity; repeat the benchmark on the selected hosting tier before increasing
concurrency. Export/document jobs must remain bounded by the existing 100k-order, 200k-row and 500-page
limits and run from durable SQLite jobs.

## Cron, rollback and support runbook

Configure Hostinger Cron with a private command or protected maintenance route to run:

```text
npm run db:maintenance -- --retention 7 --max-files 10000
```

Run backups before releases and retain at least the account policy minimum. Restore is a two-step
operation: run `npm run db:restore -- backup-<id>` for validation, stop Node, then run
`npm run db:restore -- backup-<id> --apply` and start the compatible release. Confirm `/health`, login,
queue age, webhook rejects, export/document downloads, and the restored backup manifest.

For rollback, pause the in-process job runner/cron, confirm the target application version is schema
compatible, deploy the previous compatible build, and run health plus critical smoke. Never reverse an
irreversible migration, invoice sequence, export history, or normalized evidence; use a forward fix or
restore a validated snapshot only with owner approval. Support escalation must include the correlation
ID, job/batch ID, backup manifest ID and redacted error category—never credentials or raw customer data.
