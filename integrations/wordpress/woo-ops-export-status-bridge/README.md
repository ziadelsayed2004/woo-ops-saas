# Woo Ops Export Status Bridge

Current version: **1.8.0**. This release mirrors the exact `Export Status` column shown by
**Advanced Order Export for WooCommerce (AlgolPlus)**. That column and its
`woe_export_status` sorter read the `woe_order_exported` order metadata key, including any
profile postfixes supplied through `woe_export_status_postfixes_to_verify`. The bridge now
uses that same key and filter first.

This optional companion exposes the protected export flag maintained by the installed order-export
extension. Standard Woo REST responses omit protected metadata, so Woo Ops cannot otherwise
distinguish an exported order from a not-exported one.

Compatibility reads for WooCommerce Customer / Order / Coupon Export's private
`wc_export_is_order_exported` taxonomy and legacy
`_wc_customer_order_csv_export_is_exported` flag remain available only when AlgolPlus is not active.

## Install

1. Zip the `woo-ops-export-status-bridge` directory.
2. In WordPress, open **Plugins > Add New > Upload Plugin**, upload the ZIP, and activate it.
3. In Woo Ops, run a normal synchronization or safe reinitialization.

When upgrading from 1.0, upload the replacement ZIP and approve replacing the installed plugin,
then activate it if WordPress does not keep it active automatically.

The existing WooCommerce read-only consumer key authenticates requests. The plugin adds only:

```text
GET /wp-json/wc/v3/woo-ops/export-status?ids=42,43
```

Requests are capped at 100 order IDs and require a WooCommerce-capable authenticated user. The
response contains only the order ID, the allowlisted metadata key, and `exported` or
`not_exported`. It does not expose customer data and registers no mutation route.

This remote status is displayed separately from Woo Ops local export history. Creating or undoing a
local Woo Ops spreadsheet/PDF export never changes the WordPress flag.
