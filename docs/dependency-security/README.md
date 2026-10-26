# Dependency security review

Evidence captured 2026-10-26 against `origin/main` at `8b831cb`, including the
merged credential-isolation fixes in [PR #43](https://github.com/goldjg/i-see-mp/pull/43)
and [PR #44](https://github.com/goldjg/i-see-mp/pull/44). This is **partial
remediation, not a vulnerability-free dependency graph**.

## Evidence and inventory

The existing checkout had a modified `scripts/demo.sh` and an untracked package
store. They were preserved; implementation uses a separate worktree/branch.
Repository instructions, security guidance, manifests, shared lockfile, examples,
Dockerfile, Compose file, SDK release notes and both merged PRs were examined.

GitHub Dependabot alerts and the dependency-graph SBOM were accessible. Alerts and
security updates were already enabled; no repository security settings were
changed. There were no repository-published advisories, issues or existing
Dependabot configuration/PRs at review time, and no GitHub Actions workflows.

Complete machine-readable evidence:

- [Workspace inventory](workspace-inventory.csv): every declared dependency and
  actual locked resolution in all 14 importers, before and after.
- [Resolved inventory](resolved-inventory.csv): all 619 distinct package versions
  across the before/after graphs, Node engines, licenses, registry deprecations,
  SRI and availability of signatures/provenance. The updated graph has 544 entries,
  including platform-specific optional packages, versus 535 before.
- [Advisory assessment](advisory-assessment.csv): every one of the 143 baseline
  npm audit records, IDs/CVEs where available, installed/affected/patched ranges,
  remaining versions, prerequisites, application paths and decisions.

`pnpm audit --json` reported **143 records (123 distinct GHSAs) before; 17
records (16 distinct GHSAs) after**. Thus 126 audit records / 107 distinct GHSAs no
longer appear. Counts are advisory records, not independent exploitable bugs.
Remaining severities: 2 critical, 4 high, 10 moderate, 1 low. An independent OSV
batch query of every updated package/version returned exactly the same 16 GHSA
IDs. GitHub's scope labels sometimes differ from actual execution: Vite/Babel are
build/dev tooling even where dependency-graph alerts label them runtime.

Registry SRI matched the lockfile for all 619 versions. SDK 1.32.2 advertises npm
signatures and GitHub Actions trusted-publisher provenance. Presence of metadata
is **not** independent cryptographic verification of signatures/attestations or a
malware audit. No new registry or direct runtime package was introduced.

### Main resolutions

| Consumers                                   | Dependency                      | Baseline       | Updated                       |
| ------------------------------------------- | ------------------------------- | -------------- | ----------------------------- |
| Collector, tester, all four examples        | `@modelcontextprotocol/sdk`     | 1.29.0         | 1.32.2                        |
| API                                         | `fastify`                       | 5.8.5          | 5.12.7                        |
| Root tests/coverage                         | `vitest`, `@vitest/coverage-v8` | 3.2.4          | 3.2.7                         |
| Root test toolchain                         | `vite`                          | 7.3.2          | 7.3.7                         |
| Web dev/build                               | `vite`                          | 5.4.21         | unchanged; migration deferred |
| Core, API, collector, examples and SDK peer | `zod`                           | 3.25.76        | unchanged; migration deferred |
| API static serving                          | `@fastify/static`               | 9.1.3          | unchanged; migration deferred |
| Storage                                     | `better-sqlite3`                | 11.10.0        | unchanged                     |
| Web                                         | React / React DOM; Cytoscape    | 18.3.1; 3.33.3 | unchanged                     |
| Root/web; other packages/examples           | TypeScript                      | 5.9.3; 6.0.3   | unchanged                     |

There is one SDK/Zod resolution across consumers. Separate Vite and TypeScript
lines are intentional existing toolchain differences, not incompatible runtime
SDK instances. Fastify's updated compiler brings a separate `fast-uri` 4.x;
the SDK's AJV retains patched 3.x, each within its owning package's constraints.

## SDK security and compatibility

`^1.29.0` really locked **1.29.0**; it was not inferred from the declared minimum.
The registry's latest compatible and latest `@modelcontextprotocol/sdk` release
was **1.32.2**. The current SDK generation is separately packaged
`@modelcontextprotocol/client` / `server` **2.4.0**. The v1 maintenance line
implements MCP through 2025-11-25 and promises fixes for at least six months
after v2's 2026-07-27 release. A v2 migration needs separate review.

| GHSA / CVE                                                                           | Baseline range; fixed release | Application assessment                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------ | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [6prh-2h8m-c8cw](https://github.com/advisories/GHSA-6prh-2h8m-c8cw), CVE-2026-111769 | SDK <1.32.0; 1.32.0           | Client HTTP/SSE redirects could forward custom headers/session IDs or POST bodies across origins. PR #43 already blocks all redirects when explicitly authenticated. SDK update additionally protects unauthenticated transport/message redirects. |
| [6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h), CVE-2026-104850 | >=1.12.0 <1.31.0; 1.31.0      | OAuth credential issuer confusion. No `authProvider`, OAuth token store or SDK OAuth flow is configured; not reachable through current authentication.                                                                                             |
| [46jr-4wx8-v453](https://github.com/advisories/GHSA-46jr-4wx8-v453), CVE-2026-111768 | >=1.3.0 <1.32.0; 1.32.0       | HTTP MCP server validation memory exhaustion. Application is an MCP client; examples are stdio-only. The new server `maxToolInputElements` option is opt-in: upgrading alone would not protect an affected HTTP server.                            |
| [rvq5-wwqv-78pq](https://github.com/advisories/GHSA-rvq5-wwqv-78pq), CVE-2026-111771 | >=1.6.0 <1.32.0; 1.32.0       | SDK server bearer audience validation. No `requireBearerAuth`/`verifyBearerToken` use. The new `expectedResource` setting requires application configuration on affected servers; an upgrade alone is insufficient.                                |
| [22jm-h49p-29qw](https://github.com/advisories/GHSA-22jm-h49p-29qw), CVE-2026-111767 | >=1.24.0 <1.32.0; 1.32.0      | Experimental shared task-store session isolation. No `taskStore` or task API is configured.                                                                                                                                                        |

The update is justified by client redirect protection and maintained security
fixes, not by claiming every SDK advisory is exploitable here.

Release differences reviewed from 1.29.0 through 1.32.2:

- HTTP/SSE now follow only safe same-origin redirects by default (with a limited
  same-host HTTP-to-HTTPS exception). Cross-origin redirect deployments must use
  their final URL. We do **not** set `redirectPolicy: 'follow'`.
- PR #43's custom fetch still takes precedence: explicitly authenticated
  connections reject **all** redirects, including same-origin and upgrades.
- Content-Type is parsed as a media type rather than substring matched.
- Stdio now caps its read buffer at 10 MiB and closes on overflow. Very large
  inventories/messages may now fail instead of buffering without bound.
- OAuth persisted `issuer` fields and server options do not affect our unused
  OAuth/server paths. No transport import/API changes were required.
- Platform stdio environment defaults and explicit `env` behavior remain
  compatible. No OS-specific environment policy was replaced.

Collector and tester remain consistent: shared `remoteRequestOptions` resolves
only per-server auth; `stdioEnvironment` supplies SDK defaults plus explicit
`env`/`envRefs`, never unrestricted `process.env`. References resolve at each
connection, including rotation/replay; SQLite persists names, not resolved
secrets. Known values are redacted from metadata, results and diagnostics; raw
child stderr remains suppressed. Existing migration and replay behavior is
unchanged. Connection failures close clients; successful inventory/test clients
retain existing cleanup. No new filesystem/network permissions were added.

## Transitive remediation and decisions

Patched packages include Hono, its Node adapter, body-parser, qs, proxy-addr,
ip-address, fast-uri, find-my-way, brace-expansion, undici, js-yaml, PostCSS,
nanoid, source-map-js, Babel and browserslist tooling. Exact versions, advisory
ranges and decisions are in the CSVs.

SDK HTTP server middleware is in the dependency graph but is not an inbound
HTTP handler in this application. This distinguishes packages present on disk
from reachable server vulnerabilities. Fastify serves the actual API, but its
advisory-specific HTTP/2, trailer, trustProxy, request-schema and guarded
not-found features are not configured. These compatible updates remove known
vulnerable graph entries without asserting a demonstrated application exploit.
AJV does process SDK/server schemas; URI-parser-specific exploitation was not
established, so patched parsers are precautionary rather than a proven SSRF fix.

Three scoped overrides have specific owners and purposes:

- `express-rate-limit@8>ip-address`: the owner pins vulnerable 10.1.0 exactly;
  use patched `^10.7.4`, retaining its major API.
- `vitest@3>vite` and `vite-node@3>vite`: preserve and patch the already-existing
  test Vite 7 line instead of deduplicating it down to vulnerable web Vite 5.

The overrides are mirrored in `package.json` for pnpm 9/10 and
`pnpm-workspace.yaml` for pnpm 11+, which no longer reads manifest `pnpm` settings.
Keep both copies equal and remove overrides when the owning constraints no
longer require them. This duplication preserves the existing `pnpm >=9`
contract; neither a package-manager major upgrade nor new direct tool was forced.

### Known remaining findings / approved deferrals

The user explicitly approved compatible fixes and documentation of major
migrations. These findings are **not suppressed or dismissed**:

| Dependency                       | Remaining GHSA(s); fixed version                                                               | Exposure and next action                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zod 3.25.76                      | `GHSA-mrhx-c7xc-m3w5` / CVE-2023-54404; >=4.6.6                                                | **Plausible reachable availability risk**: a malicious MCP server can return large invalid collections to SDK Zod validation. Stdio's cap bounds raw buffering, not all validation allocations; remote responses remain unbounded. No destructive OOM proof was run. Review schema/API and `zod-to-json-schema` compatibility before migrating to Zod 4; importing v3 APIs from v4 does not fix v3 validation. |
| tinypool 1.1.1                   | `GHSA-5gmw-xhrv-c9v3`, `GHSA-85c8-ppgw-ccpr`; >=2.1.2                                          | Upstream critical worker-code-execution gadgets require a separate prototype-pollution primitive and attacker-controlled worker/module input. Development-only Vitest path; no such application exploit chain confirmed. Migrate the owning test runner, not a forced transitive major.                                                                                                                        |
| Vitest / mocker 3.2.7            | `GHSA-82fw-gwwq-j7x9`, `GHSA-qxg6-89mg-rqv8`; mocker >=4.1.12                                  | File disclosure/browser code injection needs a reachable dev WebSocket using public mocker/interceptor plugins (or authenticated browser RPC). Repository uses Node `vitest run`, not those server plugins/browser mode. Review Vitest+coverage major migration together.                                                                                                                                      |
| Web Vite 5.4.21 / esbuild 0.21.5 | Eight Vite GHSAs plus `GHSA-67mh-4wv8-2f99`, enumerated in CSV; Vite >=6.4.4, esbuild >=0.25.0 | Development/preview-server file disclosure, access-control and availability risks, not execution by generated static production assets. Do not expose dev/preview servers or run them with secrets. Migrate web Vite/plugin together; no forced esbuild major override.                                                                                                                                        |
| Static plugin 9.1.3              | `GHSA-83w8-p2f5-377r`, `GHSA-8pvw-jcv7-9cmj`; >=10.1.2                                         | Bypass requires route guards/`allowedPath` protecting static files; neither is configured. Only a public asset directory is served. Review plugin 10 compatibility before changing; never store sensitive files in `staticDir`.                                                                                                                                                                                |

Registry metadata also deprecates ESLint 9.39.4 (unsupported), glob 10.5.0
(coverage tooling) and prebuild-install 7.1.3 (native SQLite install tooling).
Their owning major/toolchain migrations are deferred; deprecation is not itself
proof of an exploitable CVE. Vitest 3 no longer receives all security backports;
Vite 5 has no patched release for the remaining advisories.

## Dependabot

`.github/dependabot.yml` uses the documented `npm` ecosystem for the entire pnpm
workspace at `/`: one entry owns the shared lock, avoiding duplicate entries per
package. Weekly Monday version updates, at most three open version PRs, and
separate production/development minor+patch groups limit routine churn. Major
updates do not match those groups and remain individually reviewable.

Security updates remain individual, separate from routine groups and the weekly
version schedule; the version-PR limit does not disable their independent
security-update limit. Existing GitHub settings already enable them. The file
does not enable alerts/security updates, auto-merge, grant permissions, or modify
repository-wide security settings. Docker gets a separate weekly root entry
with a two-PR version limit. There are no Actions dependencies to configure.

Options were checked against GitHub's current
[options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)
and validated against the current
[Dependabot v2 JSON schema](https://json.schemastore.org/dependabot-2.0.json).
GitHub's hosted updater behavior can only be observed after configuration reaches
the default branch; security updates may still need manual intervention for
major migrations or pinned transitive dependencies.

## Validation and compatibility

Validation ran on **Linux ARM64, Node 22.23.4, pnpm 12.15.0**; the official Node
archive was verified against its published SHA-256. No real credentials or
external MCP services were used.

- Frozen workspace installation succeeded; SQLite opened an in-memory database.
- `pnpm typecheck`: passed.
- `pnpm test`: **31 files, 402 tests passed**, including real HTTP/SSE fixtures,
  real subprocesses, envRefs/rotation/missing references, secret redaction,
  collector-to-tester replay, additive SQLite migrations and API/UI tests.
- Seven new regression cases cover both runtime paths: unauthenticated
  cross-origin rejection, authenticated same-origin rejection, unauthenticated
  same-origin compatibility (HTTP and SSE), and stdio buffer overflow shutdown.
- `pnpm lint`, `pnpm build`, and builds of all four examples: passed.
- Built CLI collection, analysis and safe-profile replay against the controlled
  canary MCP subprocess: three planned/confirmed test runs persisted in SQLite,
  no skips or failures. The separate safe-only fixture collected/analyzed but
  intentionally matched no safe-profile test cases.
- Whole-repository `pnpm format:check`: **fails on 35 pre-existing, unchanged
  files**, not on this patch. They were not reformatted as unrelated churn.
  Changed-file formatting and `git diff --check` both passed.
- Minimum pnpm 9.15.9 accepted the frozen lock in an isolated manifest fixture;
  pnpm 12 accepted it too. Final frozen installation left the lockfile byte-for-byte
  unchanged; importer manifests and both override copies were checked for equality.

SDK engines remain `>=18`; the new allowed Hono Node adapter 2.x requires
`>=20`, within the application's existing Node contract. Test Vite already
required Node 20.19+/22.12+; existing jsdom requires 20.19+/22.13+. No Node
engine floor was raised by this patch. Those inherited limits are stricter than
the root's broad `>=20` claim. Native macOS/Windows and other Node versions were
not run; Windows environment normalization is covered by existing unit tests,
not a Windows-host certification.

## Container, operational and residual risk

No container images, running infrastructure or deployment settings were changed.
Dockerfile builds/runs `node:20-bookworm-slim`, installs build tools from Debian,
uses an unpinned Corepack-selected pnpm, and copies the full workspace including
dev dependencies into runtime. Compose's GitHub MCP image has no explicit tag.
Node 20 is past upstream support as of this review; base-image/runtime migration,
image digests, production dependency pruning and native SQLite compatibility need
a separately reviewed change. No image/OS CVE scan was performed (no installed
Trivy/Grype or resolved image digest); the npm audit is not a container scan.

Environment filtering is not a sandbox. Local MCP code retains its OS identity's
filesystem/network/process access; runtime defaults include home/path access.
Redaction only covers known exact values, not encodings or transformed secrets.
Remote metadata/response size and computational cost remain resource risks even
after the SDK stdio limit. Untrusted servers should run in restricted identities
or containers with least-privilege credentials and network/filesystem controls.

## Independent security review

A separate post-implementation security reviewer examined dependency selection,
advisory coverage, transport changes, credential/environment boundaries,
secret persistence/logging, provenance, supply-chain implications and regression
coverage against current `origin/main`. It reported **no new confirmed findings**.
The result was checked against the actual diff, audit/OSV evidence and executed
regressions; an AI review is not proof that the code is vulnerability-free.
The documented major-migration deferrals remain unresolved.

| #   | Severity | File | Lines | Vulnerability             | Confidence |
| --- | -------- | ---- | ----- | ------------------------- | ---------- |
| -   | -        | -    | -     | No new confirmed findings | -          |

Initial reconnaissance had identified the historical ambient-credential bugs in
the stale original checkout. They are already fixed by PRs #43/#44 in the
current default-branch base; they were not treated as new patch findings.

## Rollback

Revert this PR's commit and reinstall with the restored frozen lock. No schema,
persisted-data format or runtime policy is changed. PRs #43/#44 remain in the
parent history and must not be reverted. Reverting dependency changes restores
the older vulnerable dependency graph; rollback is a compatibility escape, not
a security remediation. Do not loosen auth, origin, redirect or environment
boundaries to make an older server work.

## Authoritative references

- [SDK release notes](https://github.com/modelcontextprotocol/typescript-sdk/releases)
  and [1.29.0...1.32.2 comparison](https://github.com/modelcontextprotocol/typescript-sdk/compare/v1.29.0...1.32.2).
- [SDK v1 support policy](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x).
- [npm SDK metadata](https://registry.npmjs.org/@modelcontextprotocol%2fsdk).
- GitHub advisory URLs in the assessment CSV; [OSV API](https://api.osv.dev).
- [pnpm manifest settings compatibility](https://pnpm.io/package_json)
  and [workspace settings](https://pnpm.io/settings).
