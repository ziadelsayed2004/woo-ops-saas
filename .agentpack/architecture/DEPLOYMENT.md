# Deployment and Operations

## Local and Hostinger profile

Build the web app with Vite and run one Node/Express process. Configure a private writable
`WOO_OPS_DATA_DIR` containing the SQLite file, generated documents, exports and backups. The process
must expose `/health`, serve built web assets, and use environment-provided session/encryption secrets.
No Docker, external database, Redis, or external worker is required.

```text
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm build
pnpm --filter @woo-ops/api start
```

Hostinger uses its Node.js application manager with the API start command. Optional Cron invokes a
protected maintenance command/endpoint for queued jobs and backups. HTTP requests remain bounded;
long work is durable and resumed from SQLite.

## Backups

Backups create a consistent SQLite snapshot, copy private generated files, write a manifest with
application/schema versions, byte sizes and SHA-256 checksums, and prune only versions beyond the
configured retention. Restore supports dry-run validation before replacing live data.

## Release gates

Run agentpack validation, frozen install, format, lint, typecheck, unit tests, build, API health smoke,
connector contract tests, backup/restore tests and security checks. Never expose the data directory or
credentials through static serving, logs, errors or client bundles.
