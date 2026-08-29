# Woo Ops Delivery Roadmap

The registry contains 23 dependency-ordered tasks. Runtime status is shown by:

```bash
node .agentpack/scripts/agentpack.mjs task board
```

Current board at the last update:

- `[x]` T0001 — SQLite/Hostinger foundation
- `[x]` T0002 — CI and deployment checks
- `[x]` T0101 — SQLite migrations and scoped jobs
- `[x]` T0102 — local authentication and sessions
- `[x]` T0103 — roles, settings and audit
- `NEXT` T0201 — read-only connector SDK and Woo authorization

## Delivery phases

| Phase | Outcome | Tasks |
| --- | --- | --- |
| 0 | Vite/Express foundation, CI and deployment | T0001-T0002 |
| 1 | SQLite, authentication, roles and audit | T0101-T0103 |
| 2 | Woo read-only connection, jobs, catalog and order sync | T0201-T0204 |
| 3 | Canonical order query, filters, grid and metadata mappings | T0301-T0303 |
| 4 | Manual orders, saved views, selection and bulk operations | T0401-T0402 |
| 5 | XLSX/CSV profiles, shipping exports and exported history | T0501-T0502 |
| 6 | Invoices, thermal receipts, labels, templates and printing | T0601-T0602 |
| 7 | Costs, explainable analytics and Arabic dashboard | T0701-T0702 |
| 8 | Backup/restore, security certification, E2E and release gate | T0801-T0803 |

## Execution rule

Dependencies, not phase numbers, control readiness. The orchestrator must finish one task, create
evidence, run `task complete`, merge its branch, and rerun `task board` before starting the next task.
