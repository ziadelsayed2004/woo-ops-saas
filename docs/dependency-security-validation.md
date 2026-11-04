# Dependency security update

Validated on 2026-11-04 with Node 22.18.0 and npm 10.9.3.

## Resolved versions

| Package         | Installed version |
| --------------- | ----------------- |
| express         | 5.3.0             |
| proxy-addr      | 2.0.8             |
| body-parser     | 2.4.0             |
| vite            | 7.3.7             |
| zod             | 4.6.7             |
| brace-expansion | 5.0.12            |
| source-map-js   | 1.2.2             |
| minimatch       | 11.0.4            |
| glob            | 14.0.3            |
| unzipper        | 0.12.5            |

The old brace-expansion 1.x/2.x and minimatch 3.x/5.x installations are removed.
The full lockfile audit reports zero vulnerabilities, including development dependencies.
The CI audit now fails at moderate severity and includes development dependencies.

## Excel compatibility

ExcelJS remains at 4.4.0 in the exports workspace. The same version is also declared at the
repository root so npm applies the root security overrides to its transitive archive dependencies.

Overriding minimatch alone breaks glob 7's internal matcher assumptions. Glob is upgraded with it,
and unzipper is upgraded to remove its obsolete fstream/rimraf/glob dependency chain. Archiver
remains on its existing compatible version: newer major versions reject ExcelJS's custom streaming
buffer. No dependency source files are patched after installation.

The regression tests resolve dependencies through ExcelJS itself and verify recursive patterns,
brace alternatives, ignore rules, Arabic filenames, ZIP contents, streamed XLSX writing, normal
XLSX reading and streamed XLSX reading. Arabic names and phone numbers with leading zeros survive
the round trip.

## Verification

- Clean `npm ci --ignore-scripts` with Node 22.18.0/npm 10.9.3, followed by dependency tree inspection.
- Full `npm audit`: zero vulnerabilities; `npm ls` reports the patched versions without invalid dependencies.
- Full build/lint, strict typecheck, formatting, separate CSS check and secret scan.
- All 168 unit tests, 102 integration tests and 11 API end-to-end tests pass.
- All 55 browser tests pass, including export downloads, thermal printing, manual orders,
  customer reports, Arabic layouts and accessibility checks.
- Security regressions exercise IPv4-mapped proxy trust, delayed trailing bytes after a compressed
  JSON request, and early rejection of oversized bounded API collections.
- Hostinger production startup, database health, backup validation and identity persistence smoke test.

Tests use temporary synthetic data. This update changes dependency manifests, the lockfile and
security checks; it adds no database migration or change to synchronization behavior.

## Upstream references

- [Express security release](https://expressjs.com/en/blog/2026-09-30-security-releases/)
- [Body-parser security release](https://expressjs.com/de/blog/2026-10-31-security-releases/)
- [Minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249)
- [Brace-expansion advisory](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr)
- [Zod collection limits advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
