# Deployment and Operations

## Local and Hostinger profile

Build the web app with Vite and run one Node/Express process. Configure a private writable
`WOO_OPS_DATA_DIR` containing the SQLite file, generated documents, exports and backups. The process
must expose `/health`, serve the built web assets (or use `WOO_OPS_WEB_DIST_DIR` when the hosting
working directory is different), and use environment-provided session/encryption secrets.
No Docker, external database, Redis, or external worker is required.

```text
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm build
pnpm --filter @woo-ops/api start
```

Hostinger uses its Node.js application manager with `node apps/api/dist/index.js` as the start command
from the repository root (or `node dist/index.js` when the application root is `apps/api`). Set the
build command to `pnpm install --frozen-lockfile && pnpm build`, and run `pnpm db:migrate` once before
the first start. Keep `WOO_OPS_DATA_DIR` outside the public web root. HTTP requests remain bounded;
long work is durable and resumed from SQLite.

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
pnpm test:hostinger
pnpm test:e2e:critical
pnpm test:performance
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
pnpm db:backup
pnpm db:maintenance -- --retention 7 --max-files 10000
pnpm db:backup -- --retention 7 --max-bytes 1073741824
pnpm db:restore -- backup-<id>                 # validate only
pnpm db:restore -- backup-<id> --apply         # replace after validation
```

Restore validates the manifest, every checksum, SQLite integrity, schema version and foreign keys
before it stages anything. Replacement happens only after validation; a failed replacement rolls
the database and private files back to their previous paths. Keep the data directory private and
run restore while the Node process is stopped so no open SQLite handle can race the replacement.

## Release gates

Run agentpack validation, frozen install, format, lint, typecheck, unit tests, build, API health smoke,
connector contract tests, critical E2E, performance, Hostinger smoke, backup/restore tests and security
checks. Never expose the data directory or credentials through static serving, logs, errors or client
bundles.

## Capacity baseline and operating limits

The checked-in benchmark uses Node 24 on Windows with SQLite WAL, 25 warm iterations, a 100-row page,
and synthetic order payloads. The enforced p95 budgets are:

| Operation | Budget |
| --- | ---: |
| order list | 700 ms |
| typed filtered list | 700 ms |
| text search | 1,500 ms |
| cross-page selection page | 700 ms |
| durable job enqueue/claim/complete | 250 ms |

The observed 100k-order baseline is 86.42 ms list, 88.02 ms filtered list, 130.95 ms search,
82.77 ms selection, and 0.50 ms job round-trip p95. These are a release regression budget, not a
promise of Hostinger capacity; repeat the benchmark on the selected hosting tier before increasing
concurrency. Export/document jobs must remain bounded by the existing 100k-order, 200k-row and 500-page
limits and run from durable SQLite jobs.

## Cron, rollback and support runbook

Configure Hostinger Cron with a private command or protected maintenance route to run:

```text
pnpm db:maintenance -- --retention 7 --max-files 10000
```

Run backups before releases and retain at least the account policy minimum. Restore is a two-step
operation: run `pnpm db:restore -- backup-<id>` for validation, stop Node, then run
`pnpm db:restore -- backup-<id> --apply` and start the compatible release. Confirm `/health`, login,
queue age, webhook rejects, export/document downloads, and the restored backup manifest.

For rollback, pause the in-process job runner/cron, confirm the target application version is schema
compatible, deploy the previous compatible build, and run health plus critical smoke. Never reverse an
irreversible migration, invoice sequence, export history, or normalized evidence; use a forward fix or
restore a validated snapshot only with owner approval. Support escalation must include the correlation
ID, job/batch ID, backup manifest ID and redacted error category—never credentials or raw customer data.
