# ADR-004: Single-installation account boundary

- Status: accepted
- Date: 2026-08-29

The supported deployment represents one merchant account and its connected WooCommerce stores. Records
still carry an internal account boundary, and repositories/use cases receive server-side authenticated
context. The browser cannot provide account authority. Roles are owner, admin, operator and viewer.

This avoids hosted billing and cross-organization complexity while preserving a future migration path:
hosted multi-tenancy can be added through repository/storage routing without rewriting order modules.
