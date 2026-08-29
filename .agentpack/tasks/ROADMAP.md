# Delivery Roadmap

The registry contains 62 production tasks. Phase is an ordering signal; dependencies are the actual
execution authority.

| Phase | Outcome | Main task ranges |
| --- | --- | --- |
| 0 | Monorepo, CI, local services, contracts/telemetry | T0001-T0004 |
| 1 | Identity, organizations, RBAC, tenant persistence, audit, plans | T0101-T0106 |
| 2-3 | Read-only connector SDK, Woo auth/catalog/order sync, webhooks, mapping | T0201-T0210 |
| 3 | Canonical orders, advanced filters/search, grid, details, manual orders | T0301-T0310 |
| 4 | Cross-page selection, bulk actions, export profiles/XLSX/history | T0401-T0407 |
| 4-5 | Object storage, templates, invoices, thermal labels and print | T0501-T0506 |
| 6 | Costs, explainable metrics, facts, APIs and dashboards | T0601-T0605 |
| 7 | Connection, organization and operations administration | T0701-T0703 |
| 8-9 | Isolation, certification, E2E, scale, RTL, resilience, security, launch | T0801-T0811 |

## Product milestones

### M1: Engineering foundation

T0001-T0105. Exit when tenancy/auth/audit and CI are trustworthy.

### M2: Imported Woo orders

T0201-T0209 plus T0301-T0306. Exit when a pilot store syncs safely and operators can search/filter
orders while local fields survive remote updates.

### M3: Operations MVP

T0307-T0310, T0401-T0407, and T0501-T0506. Exit when manual orders, bulk selection, XLSX, invoices,
thermal print, labels, and exported history work end to end.

### M4: SaaS intelligence and administration

T0601-T0703. Exit when costs/metrics are explainable and tenant admins can operate the service
without database access.

### M5: Production readiness

T0801-T0809 and T0811. T0810 is a post-core portability proof unless explicitly promoted into the
launch gate.

## Critical path

```text
T0001 -> T0003/T0004 -> T0101/T0104 -> T0201/T0204 -> T0205/T0206
-> T0301 -> T0302 -> T0207 -> T0208/T0209
-> T0303/T0304/T0305 -> T0401/T0402 -> T0404/T0405/T0406/T0407
-> T0502/T0503/T0504/T0505/T0506 -> T0803/T0804 -> T0808/T0811
```

## Safe parallel lanes

After T0001, CI and local infrastructure may proceed in parallel. After tenancy foundations,
connection security/SDK and selected UI shells may proceed only when their contracts are stable.
Documents, exports, and analytics may overlap after canonical order and worker/file foundations,
but shared contract and index changes must be serialized.
