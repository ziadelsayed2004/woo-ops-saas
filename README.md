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
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm dev
```

The API listens on `http://localhost:3000`; health is available at `/health`.

## Hostinger deployment

Create a Node.js application and set its start command to `node apps/api/dist/index.js` from the
repository root (or `node dist/index.js` when the application root is `apps/api`). Set
`WOO_OPS_DATA_DIR` to a writable directory outside the public web root, configure production secrets
from `.env.example`, run `pnpm db:migrate`, and expose `/health` as the health check. The API serves
the built Vite application from `apps/web/dist`; set `WOO_OPS_WEB_DIST_DIR` when Hostinger uses a
different working directory. Optional Cron can invoke bounded maintenance for jobs and backups.
Backups include the SQLite snapshot and private generated files, with checksum manifests and dry-run
restore:

```text
pnpm db:maintenance
pnpm db:restore -- backup-<id>
pnpm db:restore -- backup-<id> --apply
```

Before release, run the complete local gate matrix: `pnpm agent:doctor`, `pnpm agent:validate`,
`pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`,
`pnpm test:contract`, `pnpm test:security`, `pnpm test:tenant-isolation`, `pnpm test:chaos`, `pnpm test:golden`,
`pnpm test:e2e:critical`, `pnpm test:e2e`, `pnpm test:a11y`, `pnpm test:visual`,
`pnpm test:performance`, `pnpm test:hostinger`, `pnpm security:scan`, `pnpm security:audit`,
`pnpm build`, and `git diff --check`. The CI workflow runs the non-platform-specific quality,
security, artifact, critical-E2E and operations gates, plus Linux browser E2E/accessibility and a
Windows visual-baseline job. Live Woo authorization, Hostinger/DNS/TLS configuration, and legal/tax
policy remain owner-provided launch inputs.

## Agent-driven delivery

Use `node .agentpack/scripts/agentpack.mjs task next` and `task start <TASK_ID>`. One task uses one
sibling worktree. Read references, run validations, write `.agentpack/results/<TASK_ID>.md`, and commit
with the task ID.
