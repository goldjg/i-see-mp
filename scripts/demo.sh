#!/usr/bin/env bash

set -Eeuo pipefail

PORT="${PORT:-7474}"
DB_PATH="${DB_PATH:-iseemp-demo.db}"
CONFIG_PATH="${CONFIG_PATH:-iseemp.dv-mcp.config.json}"

log() {
  printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

fail() {
  printf '\n[ERROR] %s\n' "$*" >&2
  exit 1
}

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

log "ISeeMP demo bootstrap"

command -v node >/dev/null 2>&1 || fail "Node.js is not installed or not in PATH"

NODE_VERSION="$(node -v)"
log "Using Node ${NODE_VERSION}"

[ -f "package.json" ] || fail "Run this from inside the ISeeMP repo bundle"
[ -d "node_modules" ] || fail "node_modules missing"
[ -f "packages/cli/dist/index.js" ] || fail "CLI build output missing"
[ -d "apps/web/dist" ] || fail "Web UI build output missing"

if [ ! -f "$CONFIG_PATH" ]; then
  fail "Missing config file: $CONFIG_PATH"
fi

log "Using config: $CONFIG_PATH"

if [ ! -f "$DB_PATH" ]; then
  log "Prebuilt demo DB not found — generating fresh dataset"

  node packages/cli/dist/index.js collect \
    --config "$CONFIG_PATH" \
    --db "$DB_PATH"

  node packages/cli/dist/index.js analyze \
    --db "$DB_PATH"

  node packages/cli/dist/index.js test \
    --profile dv-lethal-trifecta \
    --db "$DB_PATH"
else
  log "Using existing demo DB: $DB_PATH"
fi

log "Starting ISeeMP UI on http://localhost:${PORT}"

node packages/cli/dist/index.js serve \
  --db "$DB_PATH" \
  --port "$PORT"
