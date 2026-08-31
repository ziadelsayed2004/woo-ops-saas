# UI and Interaction Specification

## Navigation

Primary navigation:

- Overview
- Orders
- Manual orders
- Exports
- Documents
- Analytics
- Connections
- Settings

Organization switcher is globally visible. Store and timezone context are explicit. Sync health is
visible without blocking normal order work.

## Orders workspace

The default layout contains:

1. Search field with typed suggestions.
2. Saved-view selector.
3. Filter builder with compact active-filter chips.
4. Source/store/status/export quick filters.
5. Virtualized data grid.
6. Persistent selection/action bar.
7. Right-side order preview drawer; full detail remains a route.

The grid never loads the complete dataset into the browser. Selection supports two modes:

- Explicit IDs.
- Entire query snapshot with explicit exclusions.

When the user chooses “select all matching,” show the exact query timestamp and an estimate. Before
any action, resolve a current count on the server and explain whether new orders arriving after the
snapshot are included. Default behavior excludes later arrivals.

## Bulk action safety

- Destructive or history-changing actions require confirmation and an audit reason.
- Preview count, stores, currencies, and warnings before enqueue.
- Progress drawer shows queued, running, succeeded, failed, cancelled, and partial states.
- Per-order failures are downloadable and retryable.
- Never display a control that implies the SaaS can mutate a remote platform.

## Order detail hierarchy

Header: order number, origin badge, remote status, local status, export state, totals, store, dates.

Tabs:

- Summary
- Items
- Customer and addresses
- Payment, shipping, tax, fees, refunds
- Local workflow
- Exports and documents
- Sync timeline
- Audit
- Raw source data, restricted

Remote facts and local operational data use distinct visual labels and explanatory tooltips.

## Manual order form

Sections follow the same structure as imported order detail. Selecting a synced product creates a
snapshot and explicitly states that remote stock will not change. Free-form lines require name,
quantity, unit price, tax policy, and optionally unit cost/SKU.

Before save, show totals and the permanent “local only” guarantee.

## Export builder

- Start from a saved profile or blank profile.
- Choose row model, columns, labels, formats, transforms, defaults, and validations.
- Drag to reorder.
- Preview sanitized sample rows.
- Validate required carrier fields before enqueue.
- Show exported state implications before running.

## Documents and printing

- Template editor uses safe tokens and a side-by-side preview.
- Physical-size selector: A4, A5, 80mm roll, 100x150mm label.
- Print preview includes page count and detects overflow.
- Browser print instructions are concise; generated PDF remains the source of truth.
- Batch generation is shown as a durable progress table with queued, running, completed,
  partial, failed, and cancelled states; each row exposes processed, succeeded, and failed counts.
- Batch details list private per-order PDFs, merged PDF, ZIP, and manifest downloads. Successful
  documents remain available after an individual order fails, and failed items have a retry action.
- Download controls use authenticated account-scoped routes; no artifact is rendered as a public URL.
- Legal invoice wording and numbering remain disabled until the local policy records an explicit
  external approval reference; the UI does not claim tax or legal compliance.

## Accessibility and RTL

- All actions have visible names and keyboard shortcuts must be discoverable.
- Focus returns predictably after dialogs and drawers.
- Color never communicates status alone.
- Arabic layout mirrors navigation and forms but order numbers, SKUs, phone numbers, and currency
  tokens retain readable direction isolation.
- Thermal templates must be tested with Arabic shaping and embedded fonts.
