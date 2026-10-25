<!-- version: 1.0.0 -->

# Current PR Contract

This contract constrains implementation scope for the active PR. Update
it when scope is explicitly amended. If a requested action falls outside
approved scope, stop and escalate before proceeding.

## Goal

Scope stdio MCP subprocess environments explicitly and consistently in collector
and tester, independently of the remote credential boundary fixed in PR #43.

## Non-goals

No sandbox claims, endpoint allowlist, SDK upgrade, or production changes.

## Approved scope

Shared stdio environment construction; explicit per-server environment references;
reference-only persistence; response/error/stderr safety; real subprocess regressions;
migration and threat-model documentation. User approved this scope after review.

## Forbidden scope

Do not modify real credentials, GitHub settings, infrastructure, or unrelated existing work.
Do not merge or publish packages.

## Architectural constraints

Reuse core schemas and SQLite's additive migration pattern. Preserve remote
HTTP/SSE isolation. Rely on the SDK's platform-specific runtime defaults, never
spread process.env. No new dependencies.

## Security constraints

Resolve only explicitly selected stdio references at connection time. Reference
values override literal env entries. Fail closed with value-free errors for invalid
names, NUL values, missing references, and Windows case collisions. Never persist
resolved values. Redact configured values before inventory/evidence and diagnostics;
do not forward raw child stderr. This is environment hygiene, not OS isolation.

## Files expected to change

Core, collector, tester, storage, focused integration tests and fixtures, README.

## Tests / validation

Synthetic local HTTP/SSE/stdio regressions, config/persistence/API coverage;
pnpm test, pnpm typecheck, pnpm lint, pnpm build, changed-file Prettier check.

## Stop conditions

Unexpected conflicting user changes, or a fix requiring unrelated infrastructure changes.

## Escalation triggers

Any need to broaden credential trust, add dependencies, or modify infrastructure.

## Context reset notes

Isolated worktree based on origin/main; preserve the original checkout's dirty work.
