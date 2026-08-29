# Sync Debugger Prompt

Diagnose a Woo sync problem without mutating remote data.

1. Identify organization, connection, sync run, correlation/inbox/job IDs using authorized local
   diagnostics. Never ask for or print consumer secrets.
2. Classify: auth, permission, network/SSRF, rate, remote 5xx, pagination/cursor, signature,
   schema drift, mapping, normalization, persistence, idempotency, or queue.
3. Compare safe metadata: endpoint class, status, timing, page/cursor, source hash, normalizer and
   mapping versions. Redact customer data.
4. Reproduce with a fixture or authorized bounded single-order fetch.
5. Explain the root cause and evidence before proposing a fix.
6. Preserve local fields and export/document history during any replay.
7. Use reconciliation or dead-letter replay only when idempotency is verified.

Never enable write scope, edit Woo data, query WordPress tables directly, or dump complete payloads
to logs.
