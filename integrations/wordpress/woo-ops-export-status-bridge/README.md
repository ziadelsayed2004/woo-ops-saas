# Woo Ops Export Status Bridge

Current version: **1.5.0**. This release reads the legacy export flag from both
the Woo order object and WordPress post metadata so classic storage and HPOS
compatibility mode report the same tick shown by the export extension's order column.

This optional companion exposes the protected global export flag maintained by WooCommerce
Customer / Order / Coupon Export. Standard Woo REST responses omit protected metadata, so Woo Ops
cannot otherwise distinguish an exported order from a not-exported one.

Version 1.1 reads the current plugin's private `wc_export_is_order_exported` taxonomy and its
`global` term. It retains read-only compatibility with the legacy
`_wc_customer_order_csv_export_is_exported` metadata flag.

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
