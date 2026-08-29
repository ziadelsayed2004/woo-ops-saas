# Deployment and Operations

## No-VPS production profile

The system does not require a self-managed VPS. Deploy managed components:

| Component | Runtime requirement |
| --- | --- |
| Web | Static/CDN hosting |
| API | Long-running Node container with HTTPS ingress |
| Worker | Long-running Node container with Chromium and queue access |
| Database | MongoDB Atlas |
| Queue/cache | Managed Redis |
| Files | S3-compatible object storage |
| Email | Transactional email provider |
| Telemetry | Managed logs/traces/error reporting |

Do not deploy worker/PDF/sync workloads exclusively to short-lived edge functions.

## Database tiers

- Local development: local Mongo container or ephemeral test database.
- Prototype: Atlas M0 Free only for small development/proof-of-concept usage.
- Early low-throughput pilot: Atlas Flex with monitored storage/operation limits.
- Production: Atlas Dedicated when availability, backup, private networking, throughput, or storage
  requirements exceed lower tiers.

As of 2026, old Atlas Serverless/M2/M5 paths have been replaced by Free/Flex/Dedicated choices.
Deployment IaC must not reference deprecated serverless instance APIs.

## Environments

- Local: Docker Compose dependencies, fake email, local object storage, Woo fixtures.
- Preview: isolated application and ephemeral or namespaced services; sanitized data only.
- Staging: production topology, dedicated test Woo store, no production credentials.
- Production: protected deployment, manual approval, backups, alerting, and rollback.

## CI pipeline

1. Agent-pack validation.
2. Lockfile and generated-contract consistency.
3. Format, lint, and TypeScript project references.
4. Unit and tenant-isolation tests.
5. Integration tests with Mongo/Redis/object storage.
6. Connector fixture contract tests.
7. API schema diff and migration/index review.
8. Critical Playwright E2E.
9. Security/secret/dependency scans.
10. Build web/API/worker images and SBOM.

## CD pipeline

1. Deploy database indexes/migrations using an idempotent release job.
2. Deploy API compatible with old/new job payload versions.
3. Deploy workers with controlled concurrency.
4. Deploy web.
5. Run smoke and synthetic connection tests.
6. Observe error, latency, queue, and sync-lag gates.
7. Promote or rollback application images; never roll back irreversible data blindly.

## Health and service indicators

- API availability and latency.
- Authentication and authorization error anomalies.
- Webhook acceptance, verification failure, inbox lag, and duplicate rate.
- Per-connection sync lag and cursor progress.
- Queue depth, oldest job age, attempts, dead letters.
- Woo request latency/error/rate behavior.
- Mongo latency, connections, storage, index efficiency.
- Export/PDF duration, failure, file-store error, and Chromium memory.
- Tenant isolation/security alerts.

## Scaling

- Scale API independently from workers.
- Separate worker queues: sync, bulk, export, documents, analytics, maintenance.
- Apply per-organization and per-connection fairness limits.
- Bound Mongo pools in serverless/PaaS instances.
- Store large manifests/results in object storage rather than job payloads or Mongo arrays.
- Add dedicated search/analytics strategies only after measured index/aggregation limits.

## Backup and disaster recovery

- Database backups match paid tier and business RPO/RTO.
- Object storage uses versioning/lifecycle where supported.
- Credential encryption key recovery is separately protected.
- Quarterly restore drill verifies database, files, checksums, sequence state, and application
  compatibility.
- Recovery runbook includes lost webhooks: restore, restart ingestion, then run bounded
  reconciliation before declaring freshness.

## Production readiness gate

- Pilot Woo payloads certified.
- Load test at expected first-year order volume.
- Tenant isolation suite clean.
- Backup restore demonstrated.
- Secret rotation demonstrated.
- Webhook and polling reconciliation demonstrated.
- Invoice/legal decisions approved.
- Queues, storage, database, and Chromium alerts active.
- Support and incident owner assigned.
