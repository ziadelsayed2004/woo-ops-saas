# Woo Ops

Woo Ops is a deployable WooCommerce order-operations application. It keeps a local normalized copy
of WooCommerce data for search, filtering, exports, invoices, labels, printing and analytics.

## Product boundary

- WooCommerce connectivity is read-only; `exported` and export history are local.
- Manual orders are local-only and never affect WooCommerce inventory.
- SQLite is the operational database. PDF/XLSX files and backups live in a private data directory.
- Arabic RTL is the default interface; English and LTR are supported.

## Development

```bash
npm ci
npm run db:migrate
npm run dev
```

The API listens on `http://localhost:3000`; health is available at `/health`.

## Hostinger deployment

Create a Node.js 18.x application with repository root `./`, build command `npm run build`, output
directory `.`, and entry file `apps/api/dist/index.js`. Do not define `PORT`; Hostinger injects it.
The project pins `better-sqlite3` 8.2.0 because later native prebuilds require a newer GLIBC than the
shared hosting image provides. Set `WOO_OPS_DATA_DIR` to a writable private directory outside the
public web root, configure production secrets from `.env.example`, and expose `/health` as the health
check. The database schema is migrated when the API opens it; `npm run db:migrate` remains available
for an explicit one-off migration from the application terminal. The API serves
the built Vite application from `apps/web/dist`; set `WOO_OPS_WEB_DIST_DIR` when Hostinger uses a
different working directory. Optional Cron can invoke bounded maintenance for jobs and backups.
Backups include the SQLite snapshot and private generated files, with checksum manifests and dry-run
restore:

```text
npm run db:maintenance
npm run db:restore -- backup-<id>
npm run db:restore -- backup-<id> --apply
```

Before release, run the complete local gate matrix: `npm run agent:doctor`, `npm run agent:validate`,
`npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`,
`npm run test:contract`, `npm run test:security`, `npm run test:tenant-isolation`, `npm run test:chaos`, `npm run test:golden`,
`npm run test:e2e:critical`, `npm run test:e2e`, `npm run test:a11y`, `npm run test:visual`,
`npm run test:performance`, `npm run test:hostinger`, `npm run security:scan`, `npm run security:audit`,
`npm run build`, and `git diff --check`. The CI workflow runs the non-platform-specific quality,
security, artifact, critical-E2E and operations gates, plus Linux browser E2E/accessibility and a
Windows visual-baseline job. Live Woo authorization, Hostinger/DNS/TLS configuration, and legal/tax
policy remain owner-provided launch inputs.

## Agent-driven delivery

Use `node .agentpack/scripts/agentpack.mjs task next` and `task start <TASK_ID>`. One task uses one
sibling worktree. Read references, run validations, write `.agentpack/results/<TASK_ID>.md`, and commit
with the task ID.
