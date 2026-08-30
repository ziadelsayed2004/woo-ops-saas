# Release Workflow

## Pre-release

- Agent pack and task graph validate.
- Required task evidence and CI are complete.
- API/queue/snapshot compatibility reviewed.
- Index/migration plan has estimated duration, rollout, verification and rollback/forward-fix.
- Woo fixture certification, account isolation, security and critical E2E pass.
- Load/capacity and queue concurrency fit the deployment tier.
- Backup and restore evidence is current.
- Product owner approves invoice/legal, retention and metric policy decisions.

## Deployment order

1. Verify backups and active incident channel.
2. Run compatible idempotent index/migration release job.
3. Deploy API.
4. Start the in-process job runner with a bounded concurrency configuration.
5. Deploy web.
6. Run auth, test-store health, webhook, query, manual order, export and PDF smoke tests.
7. Observe lag/errors/latency/resources, then raise job-runner concurrency within the hosting tier.

## Rollback

Application image rollback is allowed only while data contracts remain compatible. Never blindly
reverse an irreversible migration, invoice sequence, export history, or normalized evidence.
Prefer forward-fix or compatibility mode. Pause affected job queues before any corrective data job.

## Launch watch

Monitor per-connection lag, webhook rejects, queue age, duplicate/idempotency rate, SQLite query
latency, storage/PDF failures, authentication anomalies, cross-account security alarms, and support
reports. Record go/no-go owner and observation window.
