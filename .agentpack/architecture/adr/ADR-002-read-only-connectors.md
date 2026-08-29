# ADR-002: Commerce connectors are read-only by construction

- Status: accepted
- Date: 2026-08-27

## Context

The SaaS must ingest remote commerce facts but must not change remote order status, product, stock,
or customer data. Only local exported/workflow state changes in the SaaS.

## Decision

The connector SDK exposes authorization, health, pull, webhook verification, discovery, and
normalization. It exposes no remote mutation method or raw HTTP client to application modules.

Woo authorization requests `read` scope. If automatic webhook registration would require write
scope, users configure webhooks manually or install an optional narrowly scoped bridge. Polling and
reconciliation remain functional without automatic registration.

## Consequences

- Manual orders and local operations cannot accidentally affect inventory.
- UI, permissions, audit actions, and API routes contain no remote mutation semantics.
- Future write features require a new ADR, threat review, explicit product approval, separate
  capability, and least-privilege credentials.
