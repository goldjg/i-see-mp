#!/usr/bin/env bash
#
# End-to-end driver for validating generic (non-GitHub) MCP behavior using
# the official filesystem MCP server over stdio.
#
# What it does:
#   1. Installs @modelcontextprotocol/server-filesystem into /tmp.
#   2. Creates a safe local fixture directory under /tmp.
#   3. Writes a runtime docker compose override that bind-mounts fixture + server package.
#   4. Rebuilds and starts only the iseemp service.
#   5. Writes a stdio MCP config in-container for the filesystem server.
#   6. Runs `iseemp collect` and `iseemp analyze`.
#   7. Asserts expected generic outcomes through API checks.

set -euo pipefail

SERVICE="${ISEEMP_COMPOSE_SERVICE:-iseemp}"
API_PORT="${ISEEMP_API_PORT:-7474}"
READY_TIMEOUT="${ISEEMP_READY_TIMEOUT_SECS:-60}"
FIXTURE_DIR="${ISEEMP_FS_FIXTURE_DIR:-/tmp/fs-fixture}"
FSMCP_PKG_DIR="${ISEEMP_FS_MCP_PKG_DIR:-/tmp/fs-mcp-pkg}"
FSMCP_MOUNT_PATH="${ISEEMP_FS_MCP_MOUNT_PATH:-/tmp/fs-mcp-pkg}"
FSMCP_BIN_NAME="mcp-server-filesystem"
FSMCP_BIN_IN_CONTAINER="${FSMCP_MOUNT_PATH}/node_modules/.bin/${FSMCP_BIN_NAME}"
MAX_FINDINGS_EXCLUSIVE="${ISEEMP_FS_MAX_FINDINGS_EXCLUSIVE:-10}"
COMPOSE_OVERRIDE="${ISEEMP_FS_COMPOSE_OVERRIDE:-/tmp/compose-fs-e2e-override.yml}"
CONFIG_PATH_IN_CONTAINER="/data/iseemp.filesystem.config.json"

validate_compose_path() {
  local value="$1"
  local name="$2"
  if [[ ! "$value" =~ ^[a-zA-Z0-9._/:+-]+$ ]]; then
    echo "❌ ${name} contains unsupported characters for compose mount paths: ${value}" >&2
    exit 1
  fi
}

validate_absolute_path_no_traversal() {
  local value="$1"
  local name="$2"
  if [[ "$value" != /* ]]; then
    echo "❌ ${name} must be an absolute path: ${value}" >&2
    exit 1
  fi
  if [[ "$value" == *".."* ]]; then
    echo "❌ ${name} must not contain path traversal segments: ${value}" >&2
    exit 1
  fi
}

validate_tmp_delete_target() {
  local value="$1"
  local name="$2"
  validate_absolute_path_no_traversal "$value" "$name"
  if [[ "$value" != /tmp/* || "$value" == "/tmp" ]]; then
    echo "❌ ${name} must be a dedicated /tmp subdirectory for safe cleanup: ${value}" >&2
    exit 1
  fi
}

validate_compose_path "$FIXTURE_DIR" "ISEEMP_FS_FIXTURE_DIR"
validate_compose_path "$FSMCP_PKG_DIR" "ISEEMP_FS_MCP_PKG_DIR"
validate_compose_path "$FSMCP_MOUNT_PATH" "ISEEMP_FS_MCP_MOUNT_PATH"
validate_absolute_path_no_traversal "$FSMCP_MOUNT_PATH" "ISEEMP_FS_MCP_MOUNT_PATH"
validate_tmp_delete_target "$FIXTURE_DIR" "ISEEMP_FS_FIXTURE_DIR"
validate_tmp_delete_target "$FSMCP_PKG_DIR" "ISEEMP_FS_MCP_PKG_DIR"

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

echo "▶ Installing filesystem MCP package into ${FSMCP_PKG_DIR}…"
rm -rf "$FSMCP_PKG_DIR"
mkdir -p "$FSMCP_PKG_DIR"
npm install --no-audit --no-fund --prefix "$FSMCP_PKG_DIR" @modelcontextprotocol/server-filesystem
FSMCP_BIN="${FSMCP_PKG_DIR}/node_modules/.bin/${FSMCP_BIN_NAME}"
if [[ ! -x "$FSMCP_BIN" ]]; then
  echo "❌ Filesystem MCP binary not found at ${FSMCP_BIN}." >&2
  exit 1
fi

echo "▶ Preparing fixture at ${FIXTURE_DIR}…"
rm -rf "$FIXTURE_DIR"
mkdir -p "${FIXTURE_DIR}/nested"
printf 'ISEEMP-FIXTURE-CANARY\n' > "${FIXTURE_DIR}/canary.txt"
printf 'nested file\n' > "${FIXTURE_DIR}/nested/info.txt"
printf 'editable\n' > "${FIXTURE_DIR}/writable.txt"

echo "▶ Writing compose override to ${COMPOSE_OVERRIDE}…"
cat > "$COMPOSE_OVERRIDE" <<YAML
services:
  ${SERVICE}:
    volumes:
      - "${FIXTURE_DIR}:/fixture:ro"
      - "${FSMCP_PKG_DIR}:${FSMCP_MOUNT_PATH}:ro"
YAML

echo "▶ Stopping existing stack with override (if running)…"
"${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" down -v

echo "▶ Building ${SERVICE} image (no cache)…"
"${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" build --no-cache "$SERVICE"

echo "▶ Starting ${SERVICE} only (no deps)…"
"${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" up -d --no-deps "$SERVICE"

echo "▶ Waiting up to ${READY_TIMEOUT}s for API readiness on port ${API_PORT}…"
deadline=$(( $(date +%s) + READY_TIMEOUT ))
while :; do
  if "${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" exec -T "$SERVICE" \
      node -e "fetch('http://127.0.0.1:${API_PORT}/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))" \
      >/dev/null 2>&1; then
    echo "▶ API is ready."
    break
  fi
  if (( $(date +%s) >= deadline )); then
    echo "❌ Timed out waiting for API readiness." >&2
    "${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" logs --tail=200 "$SERVICE" >&2 || true
    exit 1
  fi
  sleep 2
done

echo "▶ Writing filesystem MCP config to ${CONFIG_PATH_IN_CONTAINER}…"
"${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" exec -T "$SERVICE" \
  sh -c "cat > ${CONFIG_PATH_IN_CONTAINER}" <<JSON
{
  "mcpServers": {
    "filesystem": {
      "transport": "stdio",
      "command": "node",
      "args": ["${FSMCP_BIN_IN_CONTAINER}", "/fixture"]
    }
  }
}
JSON

echo "▶ iseemp collect (filesystem MCP)…"
"${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" exec -T "$SERVICE" \
  iseemp collect --config "${CONFIG_PATH_IN_CONTAINER}"

echo "▶ iseemp analyze…"
"${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" exec -T "$SERVICE" \
  iseemp analyze

echo "▶ Validating tools/findings expectations through API…"
"${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" exec -T \
  -e "ISEEMP_API_PORT=${API_PORT}" \
  -e "ISEEMP_FS_MAX_FINDINGS_EXCLUSIVE=${MAX_FINDINGS_EXCLUSIVE}" \
  "$SERVICE" node - <<'JS'
const apiPort = process.env.ISEEMP_API_PORT || '7474';
const rawMaxFindingsExclusive = process.env.ISEEMP_FS_MAX_FINDINGS_EXCLUSIVE ?? '10';
if (!/^\d+$/.test(rawMaxFindingsExclusive)) {
  console.error(`❌ ISEEMP_FS_MAX_FINDINGS_EXCLUSIVE must be an integer value, got '${rawMaxFindingsExclusive}'.`);
  process.exit(1);
}
const maxFindingsExclusive = Number(rawMaxFindingsExclusive);
if (maxFindingsExclusive <= 0) {
  console.error(
    `❌ ISEEMP_FS_MAX_FINDINGS_EXCLUSIVE must be greater than zero, got '${rawMaxFindingsExclusive}' (parsed as ${maxFindingsExclusive}).`,
  );
  process.exit(1);
}

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

async function getJson(path) {
  const res = await fetch(`http://127.0.0.1:${apiPort}${path}`);
  if (!res.ok) fail(`API ${path} returned HTTP ${res.status}`);
  return res.json();
}

const [servers, tools, findings] = await Promise.all([
  getJson('/servers'),
  getJson('/tools'),
  getJson('/findings'),
]);

if (servers.length === 0) fail('No servers detected.');
const filesystemServer = servers.find((server) => server.name === 'filesystem') ?? servers[0];
if (filesystemServer.transport !== 'stdio') {
  fail(`Expected stdio transport, got '${filesystemServer.transport ?? 'unknown'}'.`);
}
if (filesystemServer.url) {
  fail(`Expected URL to be absent for stdio transport, got '${filesystemServer.url}'.`);
}

if (tools.length === 0) fail('Zero tools detected.');
const sendCaps = new Set(['SEND_EXTERNAL', 'SEND_HTTP', 'SEND_EMAIL']);
const hasLocalCaps = tools.some((tool) =>
  Array.isArray(tool.capabilities) &&
  (tool.capabilities.includes('READ_LOCAL_FILE') || tool.capabilities.includes('WRITE_LOCAL_FILE')),
);
if (!hasLocalCaps) fail('No tool classified with READ_LOCAL_FILE or WRITE_LOCAL_FILE.');

const sendCapTools = tools.filter((tool) =>
  Array.isArray(tool.capabilities) && tool.capabilities.some((cap) => sendCaps.has(cap)),
);
if (sendCapTools.length > 0) {
  fail(`Unexpected external-send capability on tools: ${sendCapTools.map((tool) => tool.name).join(', ')}`);
}

if (findings.length === 0) fail('No findings produced.');
if (findings.length >= maxFindingsExclusive) {
  fail(`Unexpectedly high finding count (${findings.length}); expected fewer than ${maxFindingsExclusive}.`);
}

const exfilFindings = findings.filter((finding) => finding.category === 'DATA_EXFILTRATION');
if (exfilFindings.length > 0) fail('Unexpected DATA_EXFILTRATION finding(s).');

const trifectaFindings = findings.filter((finding) => finding.trifectaComplete === true);
if (trifectaFindings.length > 0) fail('Unexpected trifectaComplete=true finding(s).');

const externalBoundaryFindings = findings.filter(
  (finding) => finding.boundaryCrossed === 'EXTERNAL' || finding.boundaryCrossed === 'SAAS',
);
if (externalBoundaryFindings.length > 0) fail('Unexpected EXTERNAL/SAAS boundary crossing findings.');

const onlyUnverifiedServer = findings.every((finding) => finding.category === 'UNVERIFIED_SERVER');
// This e2e intentionally treats "only UNVERIFIED_SERVER findings" as a failure signal:
// generic filesystem servers should still yield capability-driven, explainable outputs.
if (onlyUnverifiedServer) fail('Only UNVERIFIED_SERVER findings produced; expected richer classification.');

console.log(
  `✅ Filesystem MCP e2e passed. Servers: ${servers.length}. Tools: ${tools.length}. Findings: ${findings.length}. No external sink or trifecta detected.`,
);
JS

echo "ℹ️  Cleanup command:"
echo "   ${DC[*]} -f docker-compose.yml -f ${COMPOSE_OVERRIDE} down -v"
