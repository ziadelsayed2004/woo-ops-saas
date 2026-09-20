# Woo Ops Export Status Bridge

This optional companion exposes the protected global export flag maintained by WooCommerce
Customer / Order / Coupon Export. Standard Woo REST responses omit protected metadata, so Woo Ops
cannot otherwise distinguish an exported order from a not-exported one.

## Install

1. Zip the `woo-ops-export-status-bridge` directory.
2. In WordPress, open **Plugins > Add New > Upload Plugin**, upload the ZIP, and activate it.
3. In Woo Ops, run a normal synchronization or safe reinitialization.

The existing WooCommerce read-only consumer key authenticates requests. The plugin adds only:

```text
GET /wp-json/wc/v3/woo-ops/export-status?ids=42,43
```

Requests are capped at 100 order IDs and require a WooCommerce-capable authenticated user. The
response contains only the order ID, the allowlisted metadata key, and `exported` or
`not_exported`. It does not expose customer data and registers no mutation route.

This remote status is displayed separately from Woo Ops local export history. Creating or undoing a
local Woo Ops spreadsheet/PDF export never changes the WordPress flag.
