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

Create a Node.js application and set its start command to `pnpm --filter @woo-ops/api start` (or
`node apps/api/dist/index.js`). Set `WOO_OPS_DATA_DIR` to a writable directory outside the public web
root, configure secrets from `.env.example`, run `pnpm db:migrate`, and expose `/health` as the health
check. Optional Cron can invoke bounded maintenance for jobs and backups. Backups include the SQLite
snapshot and private generated files, with checksum manifests and dry-run restore:

```text
pnpm db:maintenance
pnpm db:restore -- backup-<id>
pnpm db:restore -- backup-<id> --apply
```

## Agent-driven delivery

Use `node .agentpack/scripts/agentpack.mjs task next` and `task start <TASK_ID>`. One task uses one
sibling worktree. Read references, run validations, write `.agentpack/results/<TASK_ID>.md`, and commit
with the task ID.
