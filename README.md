# Woo Ops SaaS Starter

Production-oriented agent pack for a multi-tenant WooCommerce order-management SaaS.

This repository starts with the product contract, architecture, task graph, worktree workflow,
quality gates, and provider-neutral agent instructions. Application code is intentionally created
through the ordered tasks in `.agentpack/tasks/registry.json` so each change remains reviewable.

## Product boundary

- WooCommerce and future commerce connectors are read-only.
- Remote orders, products, refunds, and status changes flow into this application.
- Export state, local workflow, documents, tags, assignments, and saved views stay local.
- Manual orders never sync to a commerce platform and never change remote inventory.
- PDFs, thermal labels, XLSX/CSV exports, and analytics use local canonical data snapshots.

## Production baseline

- React + TypeScript frontend.
- Express + TypeScript API.
- Node.js TypeScript worker.
- MongoDB Atlas for production persistence.
- Managed Redis with BullMQ for queues and locks.
- S3-compatible object storage for documents and exports.
- A long-running container runtime for the API and Chromium-enabled worker; no VPS is required.

SQLite is not the production order database. It may only be used by local tooling or isolated
tests. See `.agentpack/architecture/adr/ADR-001-database.md`.

## First commands

```bash
git init -b main
git add .
git commit -m "chore: initialize agent pack"
node .agentpack/scripts/agentpack.mjs doctor
node .agentpack/scripts/agentpack.mjs validate
node .agentpack/scripts/agentpack.mjs task next
node .agentpack/scripts/agentpack.mjs task show T0001
node .agentpack/scripts/agentpack.mjs task start T0001
```

`task start` creates a dedicated sibling worktree and branch after checking dependencies. Run the
implementation agent inside the returned worktree, one task per worktree.

## Read order for humans and agents

1. `AGENTS.md`
2. `.agentpack/product/PRD.md`
3. `.agentpack/architecture/ARCHITECTURE.md`
4. `.agentpack/tasks/README.md`
5. The selected task from `.agentpack/tasks/registry.json`
6. The task-specific references printed by `task show`

## Useful commands

```bash
npm run agent:doctor
npm run agent:validate
npm run task:list
npm run task:next
npm run worktree:list
```

The root package contains only agent-pack tooling at first. Task `T0001` creates the actual pnpm
monorepo applications and packages.
