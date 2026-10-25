<!-- version: 1.0.0 -->

# Current PR Contract

This contract constrains implementation scope for the active PR. Update
it when scope is explicitly amended. If a requested action falls outside
approved scope, stop and escalate before proceeding.

## Goal

Bind remote MCP credentials explicitly to each inspected server at runtime.

## Non-goals

No endpoint hostname allowlist, stdio environment changes, SDK upgrade, or production changes.

## Approved scope

Shared remote authentication and origin enforcement; declarative environment references;
reference-only persistence; regression fixtures; Docker/CI examples and migration docs.

## Forbidden scope

Do not modify real credentials, GitHub settings, infrastructure, or unrelated existing work.
Do not merge or publish packages.

## Architectural constraints

Reuse core schemas and SQLite's additive migration pattern. Keep arbitrary HTTP/SSE
endpoints and existing stdio behavior supported. No new dependencies.

## Security constraints

Never select an ambient PAT without a per-server reference. Resolve credentials only
when connecting, never persist resolved values. Fail closed for missing references,
credential-bearing redirects, and requests outside the configured origin. Redact
known credential values from remote responses before inventory/evidence handling.

## Files expected to change

Core, collector, tester, storage, focused API/integration tests, README and the two
GitHub Docker E2E configuration generators.

## Tests / validation

Synthetic local HTTP/SSE/stdio regressions, config/persistence/API coverage;
pnpm test, pnpm typecheck, pnpm lint, pnpm build, changed-file Prettier check.

## Stop conditions

Unexpected conflicting user changes, or a fix requiring unrelated infrastructure changes.

## Escalation triggers

Any need to change stdio inheritance, broaden credential trust, or add dependencies.

## Context reset notes

Isolated worktree based on origin/main; preserve the original checkout's dirty work.
