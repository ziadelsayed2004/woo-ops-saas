# ADR-005: Minor-unit money and UTC canonical time

- Status: accepted
- Date: 2026-08-27

## Decision

Represent money as integer minor units plus ISO currency. Convert Woo decimal strings with a
currency-aware decimal parser. Never use binary floating point for calculations.

Persist canonical time in UTC. Preserve the store timezone and remote local/GMT values when needed
for audit and deterministic normalization.

## Consequences

- Financial calculations and snapshots are reproducible.
- Currency scale and rounding policy are explicit.
- Multi-currency analytics must use a documented exchange-rate snapshot rather than silent
  conversion.
