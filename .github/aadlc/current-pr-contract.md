<!-- version: 1.0.0 -->

# Current PR Contract

This contract constrains implementation scope for the active PR. Update
it when scope is explicitly amended. If a requested action falls outside
approved scope, stop and escalate before proceeding.

## Goal

Review the complete resolved dependency graph, remediate confirmed findings with
compatible updates, and configure maintainable Dependabot monitoring.

## Non-goals

No SDK v2 migration, blanket major upgrades, sandbox claims, or production changes.

## Approved scope

User approved compatible SDK, Fastify, Vitest and transitive security updates;
weekly workspace npm and Docker Dependabot monitoring; evidence, compatibility,
rollback and deferred-major documentation; regression tests and independent review.

## Forbidden scope

Do not modify real credentials, GitHub settings, infrastructure, or unrelated existing work.
Do not merge or publish packages.

## Architectural constraints

Preserve PRs #43 and #44 without weakening their runtime policies. Keep existing
package-manager and lockfile conventions. No new direct runtime dependencies.

## Security constraints

Resolve only explicitly selected stdio references at connection time. Reference
values override literal env entries. Fail closed with value-free errors for invalid
names, NUL values, missing references, and Windows case collisions. Never persist
resolved values. Redact configured values before inventory/evidence and diagnostics;
do not forward raw child stderr. This is environment hygiene, not OS isolation.

## Files expected to change

Affected manifests and lockfile, Dependabot configuration, focused transport
regressions, dependency-security evidence and this contract.

## Tests / validation

Frozen installation and lockfile consistency; synthetic local HTTP/SSE/stdio
regressions, config/persistence/API coverage; pnpm test, pnpm typecheck, pnpm lint,
pnpm build, formatting and Dependabot schema checks; independent security review.

## Stop conditions

Unexpected conflicting user changes, or a fix requiring unrelated infrastructure changes.

## Escalation triggers

Any need to broaden credential trust, introduce substantial breaking changes,
add direct runtime dependencies, or modify infrastructure or GitHub settings.

## Context reset notes

Isolated worktree based on origin/main; preserve the original checkout's dirty work.
