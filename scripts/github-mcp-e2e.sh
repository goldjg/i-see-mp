#!/usr/bin/env bash
#
# End-to-end driver for the github-safe-canary profile against the GitHub MCP server.
#
# Semantic contract (github-safe-canary profile):
#   - Proves GitHub profile canary behavior with official github MCP sidecar integration.
#   - Servers: at least 1 github server.
#   - Tools: at least 1 github tool.
#   - Capability families: GitHub remote read/mutation families, validated by canary profile.
#   - Structural trifecta / trust transitions / trust-boundary / lethal / injection: validated by
#     `iseemp test --profile github-safe-canary` rather than inline script assertions.
#   - Trust semantics note: GitHub tools classify as CONTROLLED_SAAS by default and
#     USER_CONTROLLED_SAAS for issue/PR/discussion/search-style user-content tools.
#   - Canary gating: required (GITHUB_PERSONAL_ACCESS_TOKEN, ISEEMP_TEST_REPO_OWNER, ISEEMP_TEST_REPO_NAME).
#
# Usage:
#   GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxx \
#   ISEEMP_TEST_REPO_OWNER=octo-org \
#   ISEEMP_TEST_REPO_NAME=canary-sandbox \
#   ./scripts/github-mcp-e2e.sh
#
# What it does:
#   1. If the iseemp compose service is up, runs `docker compose down -v` to
#      remove the container and the persisted DB volume.
#   2. `docker compose build --no-cache` to force a clean rebuild.
#   3. `docker compose up -d` and waits for the API to be reachable.
#   4. Writes an iseemp.config.json inside the container that wires up the
#      official Go GitHub MCP server container (ghcr.io/github/github-mcp-server)
#      over HTTP, with the host's GITHUB_PERSONAL_ACCESS_TOKEN injected into the
#      iseemp process environment so the MCP client can forward it as a bearer token.
#   5. Runs `iseemp collect`, `iseemp analyze`, and the github-safe-canary
#      `iseemp test` profile against that collection.
#
# Required env vars:
#   GITHUB_PERSONAL_ACCESS_TOKEN  PAT with repo scope on the disposable test repo.
#   ISEEMP_TEST_REPO_OWNER        Owner of the disposable canary repo.
#   ISEEMP_TEST_REPO_NAME         Name of the disposable canary repo.
#
# Optional env vars (sensible defaults applied):
#   ISEEMP_TEST_BRANCH_PREFIX     default: iseemp-canary-
#   ISEEMP_TEST_ISSUE_PREFIX      default: ISEEMP-CANARY-
#   ISEEMP_TEST_CANARY_PREFIX     default: ISEEMP-CANARY
#   ISEEMP_COMPOSE_SERVICE        default: iseemp
#   ISEEMP_API_PORT               default: 7474
#   ISEEMP_READY_TIMEOUT_SECS     default: 60

set -euo pipefail

SERVICE="${ISEEMP_COMPOSE_SERVICE:-iseemp}"
API_PORT="${ISEEMP_API_PORT:-7474}"
READY_TIMEOUT="${ISEEMP_READY_TIMEOUT_SECS:-60}"
BRANCH_PREFIX="${ISEEMP_TEST_BRANCH_PREFIX:-iseemp-canary-}"
ISSUE_PREFIX="${ISEEMP_TEST_ISSUE_PREFIX:-ISEEMP-CANARY-}"
CANARY_PREFIX="${ISEEMP_TEST_CANARY_PREFIX:-ISEEMP-CANARY}"
CONFIG_PATH_IN_CONTAINER="/data/iseemp.github.config.json"
GITHUB_MCP_READY_PATH="${GITHUB_MCP_READY_PATH:-/.well-known/oauth-protected-resource}"

if [[ -z "${GITHUB_PERSONAL_ACCESS_TOKEN:-}" ]]; then
  echo "❌ GITHUB_PERSONAL_ACCESS_TOKEN is not set in the current shell." >&2
  exit 1
fi

if [[ -z "${ISEEMP_TEST_REPO_OWNER:-}" || -z "${ISEEMP_TEST_REPO_NAME:-}" ]]; then
  echo "❌ Set ISEEMP_TEST_REPO_OWNER and ISEEMP_TEST_REPO_NAME to a disposable canary repo." >&2
  exit 1
fi

# Resolve a docker compose CLI (v2 plugin preferred, v1 binary as fallback).
if docker compose version >/dev/null 2>&1; then
  DC=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DC=(docker-compose)
else
  echo "❌ Neither 'docker compose' nor 'docker-compose' is available on PATH." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "▶ Checking whether ${SERVICE} is currently up…"
if [[ -n "$("${DC[@]}" ps -q "$SERVICE" 2>/dev/null || true)" ]]; then
  echo "▶ ${SERVICE} is up — running 'docker compose down -v' to clear container + volume."
  "${DC[@]}" down -v
else
  echo "▶ ${SERVICE} is not up — skipping down."
fi

echo "▶ Building image (no cache)…"
"${DC[@]}" build --no-cache

echo "▶ Starting ${SERVICE} (detached)…"
"${DC[@]}" up -d

echo "▶ Waiting up to ${READY_TIMEOUT}s for the API on port ${API_PORT}…"
deadline=$(( $(date +%s) + READY_TIMEOUT ))
while :; do
  if "${DC[@]}" exec -T "$SERVICE" \
      node -e "fetch('http://127.0.0.1:${API_PORT}/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))" \
      >/dev/null 2>&1; then
    echo "▶ API is ready."
    break
  fi
  if (( $(date +%s) >= deadline )); then
    echo "❌ Timed out waiting for the iseemp API to come up." >&2
    "${DC[@]}" logs --tail=200 "$SERVICE" >&2 || true
    exit 1
  fi
  sleep 2
done

echo "▶ Waiting for github-mcp sidecar HTTP endpoint…"
# The official server exposes OAuth protected-resource metadata in HTTP mode; it is
# reachable without a PAT and provides a stable readiness signal for the sidecar.
deadline=$(( $(date +%s) + READY_TIMEOUT ))
while :; do
  if "${DC[@]}" exec -T "$SERVICE" \
      node -e "fetch('http://github-mcp:8082${GITHUB_MCP_READY_PATH}').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))" \
      >/dev/null 2>&1; then
    echo "▶ github-mcp is ready."
    break
  fi
  if (( $(date +%s) >= deadline )); then
    echo "❌ Timed out waiting for the github-mcp sidecar to come up." >&2
    "${DC[@]}" logs --tail=200 github-mcp >&2 || true
    exit 1
  fi
  sleep 2
done

echo "▶ Writing GitHub MCP config to ${CONFIG_PATH_IN_CONTAINER} inside the container…"
# The token is consumed by the iseemp MCP HTTP client at collect/test time
# (see -e injection below); we deliberately do NOT bake it into the on-disk config.
"${DC[@]}" exec -T "$SERVICE" sh -c "cat > ${CONFIG_PATH_IN_CONTAINER}" <<'JSON'
{
  "mcpServers": {
    "github": {
      "url": "http://github-mcp:8082/",
      "transport": "http"
    }
  }
}
JSON

# Helper: run an iseemp subcommand inside the container with the host PAT
# forwarded via `-e` so the spawned github MCP child inherits it.
run_iseemp() {
  "${DC[@]}" exec -T \
    -e "GITHUB_PERSONAL_ACCESS_TOKEN=${GITHUB_PERSONAL_ACCESS_TOKEN}" \
    "$SERVICE" iseemp "$@"
}

echo "▶ iseemp collect (against GitHub MCP server)…"
run_iseemp collect --config "${CONFIG_PATH_IN_CONTAINER}"

echo "▶ iseemp analyze…"
run_iseemp analyze

echo "▶ iseemp test --profile github-safe-canary…"
run_iseemp test \
  --profile github-safe-canary \
  --test-repo-owner "${ISEEMP_TEST_REPO_OWNER}" \
  --test-repo-name "${ISEEMP_TEST_REPO_NAME}" \
  --test-branch-prefix "${BRANCH_PREFIX}" \
  --test-issue-prefix "${ISSUE_PREFIX}" \
  --test-canary-prefix "${CANARY_PREFIX}"

echo "✅ Done. Open http://localhost:${API_PORT} to inspect findings, badges, and evidence."
