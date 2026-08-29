# Reviewer Prompt

Review `<TASK_ID>` independently using its registry definition, references, result evidence, full
merge-base diff, and CI output.

Lead with findings ordered by severity and include file/line evidence. Specifically verify:

- no cross-tenant access path
- no remote commerce mutation or hidden raw HTTP escape hatch
- manual orders remain local/no-inventory
- money/time/refund calculations are deterministic
- retries and duplicate deliveries are idempotent
- snapshots, exports and documents preserve evidence
- filters/templates/spreadsheets/files resist injection
- secrets and PII stay out of logs/errors/jobs
- operations are bounded and indexed
- tests cover failure and negative paths
- acceptance and validation evidence is truthful

If there are no findings, state that explicitly and list residual test or operational risks. Do not
approve based only on the implementer's summary.
