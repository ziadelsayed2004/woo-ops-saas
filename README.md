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

To inspect the authenticated screens without touching the live merchant account, run
`npm run build` then `npm run demo:local`. The command creates a temporary SQLite database and a
random local-only owner password, prints its loopback URL and login, and removes the demo database
when stopped with Ctrl+C. It does not connect to WooCommerce or contain real customer data. Never
use this demo account or its displayed password on the production subdomain.

## First owner and WooCommerce connection

After Hostinger reports a healthy deployment, open `https://ops.wasatalbalad.store/`. On a fresh
production database the first screen offers owner-account creation. Enter the account name, your
email and a unique password of at least 12 characters. This is a Woo Ops login, separate from your
WordPress login. Public account creation closes after the first owner; sign in with that account on
later visits. Do not delete the private SQLite database to recover a forgotten password.

In **Connections**, enter `https://wasatalbalad.store` and select **Start WooCommerce connection**.
Sign in to WordPress as an administrator if prompted, inspect the WooCommerce grant screen, and
approve the **read** permission. WooCommerce posts the keys directly to the application's HTTPS
callback, then sends your browser back to Connections. If the store takes a moment to appear, use
the refresh control. Run **Health check** and **Initial sync** to import the catalog and orders;
check **Operations** for progress and errors. Woo Ops never writes orders, stock or products back.

If the connection reports `WOO_PERMALINKS_BROKEN` or the Woo grant URL displays a 404, WooCommerce
is installed but WordPress rewrite rules are stale. In WordPress admin open **Settings →
Permalinks**, select **Post name** (do not use Plain), click **Save Changes** twice, clear the
Hostinger/CDN cache, and verify that both `/wp-json/` and `/wc-auth/v1/authorize` no longer show the
hosting 404 page. Then start a new connection so it receives a fresh one-time authorization state.

Set both `WEB_PUBLIC_URL` and `API_PUBLIC_URL` to `https://ops.wasatalbalad.store` in Hostinger,
without a trailing slash. Set `SESSION_SECRET` (32+ random characters) and
`TOKEN_ENCRYPTION_KEY` (a base64-encoded 32-byte random key) as private application variables; keep
the latter stable across redeployments so stored Woo keys remain decryptable. The private data
directory must survive redeployments. For near-real-time updates, click **Set up webhook** on the
connected store. Copy the displayed Delivery URL and Secret immediately. In WordPress admin open
WooCommerce → Settings → Advanced → Webhooks and create three active webhooks, one each for **Order
created**, **Order updated**, and **Order deleted**, using the same URL and Secret. Changing the secret
in Woo Ops invalidates the old one, so update all three webhooks together. Test a delivery in
WooCommerce and inspect Operations for errors. Otherwise run incremental sync/reconciliation
periodically. WordPress login is used only to approve the connection; Woo Ops members log in with
their own local accounts.

## Hostinger deployment

Create a Node.js 22.x application with repository root `./`, build command
`npm run build`, output
directory `.`, and entry file `apps/api/dist/index.js`. Do not define `PORT`; Hostinger injects it.
The project uses Node's built-in `node:sqlite`, so deployment does not require node-gyp, Python, or a
host-specific native SQLite binary. Hostinger may install with production-only dependencies before
running the build; the compiler and web bundler required for that build are therefore declared as
production build dependencies, while Playwright and formatting tools remain development-only. Set
Woo Ops automatically detects Hostinger `hbuilds` releases and stores runtime state in the stable
domain-level `.woo-ops-data` directory, outside the replaced release repository. You may instead set
`WOO_OPS_DATA_DIR` to an absolute writable private directory outside the public web root; configure production
secrets from `.env.example`, and expose `/health` as the health check. The database schema is migrated
when the API opens it; `npm run db:migrate` remains available for an explicit one-off migration from
the application terminal. The API serves
the built Vite application from `apps/web/dist`; set `WOO_OPS_WEB_DIST_DIR` when Hostinger uses a
different working directory. Optional Cron can invoke bounded maintenance for jobs and backups.
To reproduce Hostinger's boundary locally, run `npm ci --omit=dev` followed by `npm run build`.
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
