# Security and Privacy Baseline

## Trust boundaries

- Browser input is untrusted.
- Woo callbacks and webhooks are public hostile endpoints even when signed.
- Remote store URLs and redirect destinations are untrusted.
- Queue messages must be authenticated by infrastructure and schema-validated by consumers.
- Object-storage keys and signed URLs are sensitive capabilities.
- Organization membership and permission data are server authority.

## Tenant isolation controls

- Every tenant repository requires server-created `TenantContext`.
- Mongoose access from HTTP controllers is prohibited.
- Compound unique and query indexes begin with organization where applicable.
- Jobs re-load current membership/entitlement or use an explicit system actor policy.
- Cache and lock keys begin with an opaque organization ID.
- File object keys are organization-scoped and random.
- Search requests always include a server-owned tenant filter.
- Automated negative tests attempt horizontal access for every API group.

## Connector secrets

- Envelope-encrypt credentials with AES-256-GCM using a versioned key-encryption key from secret
  management.
- Store IV/nonce, authentication tag, ciphertext, key version, and credential metadata separately.
- Never store plaintext credentials in jobs, audit records, exceptions, traces, or raw snapshots.
- Decrypt only within the connector execution boundary and zero/release references promptly.
- Support rotation and a migration path for encryption keys.
- Woo credentials use read scope; the product has no remote mutation command.

## Authentication and sessions

- Passwords use a memory-hard password hash with calibrated parameters.
- Sessions use random opaque tokens, store only hashes, rotate on privilege changes, and support
  global/user/device revocation.
- Cookies are Secure, HttpOnly, SameSite, bounded, and scoped to the application origin.
- Mutating browser requests require CSRF tokens and origin verification.
- Login, password reset, invitation, and sensitive endpoints have rate limits and abuse monitoring.
- MFA-ready architecture; owner/admin MFA becomes a configurable requirement.

## Public endpoint controls

- Strict request/body size, content type, timeout, and method limits.
- Webhook raw-body HMAC verification before business parsing.
- Single-use authorization state and replay window.
- SSRF protection for store discovery and all connector requests.
- Outbound HTTP follows a connector-controlled origin policy and limited redirects.
- No arbitrary URL fields in document templates or mapping transforms.

## Input and output safety

- Zod validation at every transport boundary.
- Allowlisted filter fields/operators; no raw Mongo operators or regex from clients.
- Spreadsheet strings beginning with formula control characters are escaped.
- HTML templates use safe tokens, sanitizer, CSP, no scripts, no remote network, and restricted CSS.
- PDF renderer runs in an isolated container/profile with time/memory limits.
- Filenames and response headers prevent path traversal and header injection.

## PII and audit

- Collect only operationally necessary customer data.
- Redact email, phone, address, tokens, and raw payload content from default logs.
- Permission-protect raw data and sensitive exports.
- Record export/document downloads when policy requires.
- Retention and deletion jobs are tenant-scoped, dry-run capable, and auditable.
- Audit events record concise redacted diffs, not secrets or full documents.

## Supply chain and deployment

- Lockfile required; dependency updates are reviewed.
- CI runs secret, dependency, static, and container scans.
- Production images run non-root with read-only filesystem where possible.
- Separate API and worker identities and storage permissions.
- Environment secrets never enter images, bundles, repository, or client runtime.
- Database and Redis are network-restricted; TLS required.
- Backups and restore drills have documented RPO/RTO.

## High-risk change review

The following require explicit security review and an ADR:

- any platform write capability
- any new raw query/filter mechanism
- changes to tenant context propagation
- credential/encryption format changes
- template execution or external resource loading
- public file access
- invoice numbering changes
- broad retention deletion
- cross-organization analytics
