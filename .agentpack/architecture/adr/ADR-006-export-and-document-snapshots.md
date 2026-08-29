# ADR-006: Exports and documents are immutable snapshots

- Status: accepted
- Date: 2026-08-27

## Context

Remote and manual orders may change after operators export or print them. Auditability requires
knowing exactly what was sent or printed.

## Decision

Every successful export and document records immutable input snapshot identity, profile/template
version, source watermark, output checksum, actor, and file metadata. Re-export or regeneration
creates a new version. Exported state is derived from append-only history. Changes after the last
snapshot produce `changed-after-export` or stale-document state.

## Consequences

- Old evidence remains accurate.
- Storage lifecycle and retention are required.
- Unexport is a new audited event, not deletion of the historical batch.
