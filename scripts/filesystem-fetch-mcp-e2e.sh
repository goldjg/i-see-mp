#!/usr/bin/env bash
#
# End-to-end driver for validating conservative cross-server composition between:
#   - filesystem MCP (local source/mutation capabilities)
#   - fetch MCP (network interaction capabilities)
#
# The goal is classification sanity, not exploit confirmation. This script passes
# if both servers are discovered/classified correctly and analysis does not crash.

set -euo pipefail

SERVICE="${ISEEMP_COMPOSE_SERVICE:-iseemp}"
API_PORT="${ISEEMP_API_PORT:-7474}"
READY_TIMEOUT="${ISEEMP_READY_TIMEOUT_SECS:-60}"
FIXTURE_DIR="${ISEEMP_FS_FETCH_FIXTURE_DIR:-/tmp/fs-fetch-fixture}"
FSMCP_PKG_DIR="${ISEEMP_FS_MCP_PKG_DIR:-/tmp/fs-mcp-pkg}"
FETCHMCP_PKG_DIR="${ISEEMP_FETCH_MCP_PKG_DIR:-/tmp/fetch-mcp-pkg}"
FSMCP_MOUNT_PATH="${ISEEMP_FS_MCP_MOUNT_PATH:-/tmp/fs-mcp-pkg}"
FETCHMCP_MOUNT_PATH="${ISEEMP_FETCH_MCP_MOUNT_PATH:-/tmp/fetch-mcp-pkg}"
FSMCP_BIN_NAME="mcp-server-filesystem"
FETCHMCP_BIN_NAME="mcp-fetch-server"
FSMCP_BIN_IN_CONTAINER="${FSMCP_MOUNT_PATH}/node_modules/.bin/${FSMCP_BIN_NAME}"
FETCHMCP_BIN_IN_CONTAINER="${FETCHMCP_MOUNT_PATH}/node_modules/.bin/${FETCHMCP_BIN_NAME}"
FETCH_FIXTURE_PORT="${ISEEMP_FETCH_FIXTURE_PORT:-8787}"
FETCH_FIXTURE_SCRIPT_IN_CONTAINER="/tmp/iseemp-fetch-fixture-server.js"
CONFIG_PATH_IN_CONTAINER="/data/iseemp.filesystem-fetch.config.json"
COMPOSE_OVERRIDE="${ISEEMP_FS_FETCH_COMPOSE_OVERRIDE:-/tmp/compose-fs-fetch-e2e-override.yml}"
FETCH_FIXTURE_PID=""

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

cleanup() {
  if [[ -n "${FETCH_FIXTURE_PID}" ]]; then
    "${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" exec -T "$SERVICE" \
      sh -c "kill ${FETCH_FIXTURE_PID} >/dev/null 2>&1 || true" || true
  fi
}

validate_compose_path "$FIXTURE_DIR" "ISEEMP_FS_FETCH_FIXTURE_DIR"
validate_compose_path "$FSMCP_PKG_DIR" "ISEEMP_FS_MCP_PKG_DIR"
validate_compose_path "$FETCHMCP_PKG_DIR" "ISEEMP_FETCH_MCP_PKG_DIR"
validate_compose_path "$FSMCP_MOUNT_PATH" "ISEEMP_FS_MCP_MOUNT_PATH"
validate_compose_path "$FETCHMCP_MOUNT_PATH" "ISEEMP_FETCH_MCP_MOUNT_PATH"
validate_absolute_path_no_traversal "$FSMCP_MOUNT_PATH" "ISEEMP_FS_MCP_MOUNT_PATH"
validate_absolute_path_no_traversal "$FETCHMCP_MOUNT_PATH" "ISEEMP_FETCH_MCP_MOUNT_PATH"
validate_tmp_delete_target "$FIXTURE_DIR" "ISEEMP_FS_FETCH_FIXTURE_DIR"
validate_tmp_delete_target "$FSMCP_PKG_DIR" "ISEEMP_FS_MCP_PKG_DIR"
validate_tmp_delete_target "$FETCHMCP_PKG_DIR" "ISEEMP_FETCH_MCP_PKG_DIR"

if docker compose version >/dev/null 2>&1; then
  DC=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DC=(docker-compose)
else
  echo "❌ Neither 'docker compose' nor 'docker-compose' is available on PATH." >&2
  exit 1
fi

trap cleanup EXIT

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "▶ Installing filesystem MCP package into ${FSMCP_PKG_DIR}…"
rm -rf "$FSMCP_PKG_DIR"
mkdir -p "$FSMCP_PKG_DIR"
npm install --no-audit --no-fund --prefix "$FSMCP_PKG_DIR" @modelcontextprotocol/server-filesystem
if [[ ! -x "${FSMCP_PKG_DIR}/node_modules/.bin/${FSMCP_BIN_NAME}" ]]; then
  echo "❌ Filesystem MCP binary not found at ${FSMCP_PKG_DIR}/node_modules/.bin/${FSMCP_BIN_NAME}." >&2
  exit 1
fi

echo "▶ Installing fetch MCP package into ${FETCHMCP_PKG_DIR}…"
rm -rf "$FETCHMCP_PKG_DIR"
mkdir -p "$FETCHMCP_PKG_DIR"
npm install --no-audit --no-fund --prefix "$FETCHMCP_PKG_DIR" mcp-fetch-server
if [[ ! -x "${FETCHMCP_PKG_DIR}/node_modules/.bin/${FETCHMCP_BIN_NAME}" ]]; then
  echo "❌ Fetch MCP binary not found at ${FETCHMCP_PKG_DIR}/node_modules/.bin/${FETCHMCP_BIN_NAME}." >&2
  exit 1
fi

echo "▶ Preparing fixture at ${FIXTURE_DIR}…"
rm -rf "$FIXTURE_DIR"
mkdir -p "$FIXTURE_DIR"
printf 'ISEEMP-FETCH-FIXTURE-CANARY\n' > "${FIXTURE_DIR}/canary.txt"
printf '{"fixture":"filesystem-fetch","safe":true}\n' > "${FIXTURE_DIR}/metadata.json"

echo "▶ Writing compose override to ${COMPOSE_OVERRIDE}…"
cat > "$COMPOSE_OVERRIDE" <<YAML
services:
  ${SERVICE}:
    volumes:
      - "${FIXTURE_DIR}:/fixture:ro"
      - "${FSMCP_PKG_DIR}:${FSMCP_MOUNT_PATH}:ro"
      - "${FETCHMCP_PKG_DIR}:${FETCHMCP_MOUNT_PATH}:ro"
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

echo "▶ Writing local HTTP fetch fixture script in-container (no public internet dependency)…"
"${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" exec -T "$SERVICE" sh -c "cat > ${FETCH_FIXTURE_SCRIPT_IN_CONTAINER}" <<'JS'
const http = require('node:http');
const port = Number(process.env.ISEEMP_FETCH_FIXTURE_PORT || '8787');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(
    JSON.stringify({
      ok: true,
      source: 'local-fetch-fixture',
      path: req.url,
      ts: new Date().toISOString(),
    }),
  );
});
server.listen(port, '127.0.0.1');
JS

FETCH_FIXTURE_PID="$(${DC[@]} -f docker-compose.yml -f "$COMPOSE_OVERRIDE" exec -T "$SERVICE" \
  sh -c "ISEEMP_FETCH_FIXTURE_PORT=${FETCH_FIXTURE_PORT} node ${FETCH_FIXTURE_SCRIPT_IN_CONTAINER} >/tmp/iseemp-fetch-fixture.log 2>&1 & echo \$!")"
if [[ ! "$FETCH_FIXTURE_PID" =~ ^[0-9]+$ ]]; then
  echo "❌ Failed to start local HTTP fetch fixture; invalid PID '${FETCH_FIXTURE_PID}'." >&2
  exit 1
fi

echo "▶ Waiting for local HTTP fetch fixture on 127.0.0.1:${FETCH_FIXTURE_PORT}…"
deadline=$(( $(date +%s) + READY_TIMEOUT ))
while :; do
  if "${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" exec -T "$SERVICE" \
      node -e "fetch('http://127.0.0.1:${FETCH_FIXTURE_PORT}/fixture').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))" \
      >/dev/null 2>&1; then
    echo "▶ Local HTTP fetch fixture is ready."
    break
  fi
  if (( $(date +%s) >= deadline )); then
    echo "❌ Timed out waiting for local HTTP fetch fixture." >&2
    "${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" exec -T "$SERVICE" \
      sh -c "tail -n 100 /tmp/iseemp-fetch-fixture.log" >&2 || true
    exit 1
  fi
  sleep 1
done

echo "▶ Writing combined filesystem+fetch MCP config to ${CONFIG_PATH_IN_CONTAINER}…"
"${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" exec -T "$SERVICE" \
  sh -c "cat > ${CONFIG_PATH_IN_CONTAINER}" <<JSON
{
  "mcpServers": {
    "filesystem": {
      "transport": "stdio",
      "command": "node",
      "args": ["${FSMCP_BIN_IN_CONTAINER}", "/fixture"]
    },
    "fetch": {
      "transport": "stdio",
      "command": "node",
      "args": ["${FETCHMCP_BIN_IN_CONTAINER}"],
      "env": {
        "FETCH_BASE_URL": "http://127.0.0.1:${FETCH_FIXTURE_PORT}",
        "DEFAULT_LIMIT": "5000"
      }
    }
  }
}
JSON

echo "▶ iseemp collect (filesystem + fetch MCP)…"
"${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" exec -T "$SERVICE" \
  iseemp collect --config "${CONFIG_PATH_IN_CONTAINER}"

echo "▶ iseemp analyze…"
"${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" exec -T "$SERVICE" \
  iseemp analyze

echo "▶ Validating cross-server classification expectations through API…"
"${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" exec -T \
  -e "ISEEMP_API_PORT=${API_PORT}" \
  "$SERVICE" node - <<'JS'
const apiPort = process.env.ISEEMP_API_PORT || '7474';

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

if (servers.length < 2) fail(`Expected at least 2 servers, got ${servers.length}.`);
if (tools.length === 0) fail('Zero tools detected.');

const filesystemServer = servers.find((server) => server.name === 'filesystem');
const fetchServer = servers.find((server) => server.name === 'fetch');
if (!filesystemServer) fail('Filesystem server not detected.');
if (!fetchServer) fail('Fetch server not detected.');

const filesystemTools = tools.filter((tool) => tool.serverId === filesystemServer.id);
const fetchTools = tools.filter((tool) => tool.serverId === fetchServer.id);
if (filesystemTools.length === 0) fail('No tools discovered for filesystem server.');
if (fetchTools.length === 0) fail('No tools discovered for fetch server.');

const hasCap = (tool, cap) => Array.isArray(tool.capabilities) && tool.capabilities.includes(cap);

const hasFilesystemLocalRead = filesystemTools.some((tool) => hasCap(tool, 'READ_LOCAL_FILE'));
if (!hasFilesystemLocalRead) fail('Filesystem server has no READ_LOCAL_FILE-classified tools.');

const hasFetchNetwork = fetchTools.some(
  (tool) => hasCap(tool, 'SEND_HTTP') || hasCap(tool, 'READ_REMOTE_DATA'),
);
if (!hasFetchNetwork) fail('Fetch server has no SEND_HTTP or READ_REMOTE_DATA classification.');

const filesystemUnexpectedSend = filesystemTools.filter(
  (tool) => hasCap(tool, 'SEND_EXTERNAL') || hasCap(tool, 'SEND_HTTP') || hasCap(tool, 'SEND_EMAIL'),
);
if (filesystemUnexpectedSend.length > 0) {
  fail(
    `Filesystem tools unexpectedly classified as external send: ${filesystemUnexpectedSend
      .map((tool) => tool.name)
      .join(', ')}`,
  );
}

const fetchUnexpectedLocalRead = fetchTools.filter((tool) => hasCap(tool, 'READ_LOCAL_FILE'));
if (fetchUnexpectedLocalRead.length > 0) {
  fail(
    `Fetch tools unexpectedly classified as READ_LOCAL_FILE: ${fetchUnexpectedLocalRead
      .map((tool) => tool.name)
      .join(', ')}`,
  );
}

const complete = findings.filter((finding) => finding.trifectaComplete === true).length;
const partial = findings.filter((finding) => finding.trifectaStage === 'PARTIAL').length;
const capabilityOnly = findings.filter((finding) => finding.trifectaStage === 'CAPABILITY_ONLY').length;
const crossServerFindings = findings.filter((finding) => finding.isCrossServer === true);
const crossServerPartial = crossServerFindings.filter((finding) => finding.trifectaStage === 'PARTIAL');
const crossServerComplete = crossServerFindings.filter((finding) => finding.trifectaComplete === true);

console.log(
  `✅ Filesystem+Fetch MCP e2e summary. Servers: ${servers.length}. Tools: ${tools.length}. Findings: ${findings.length}. Trifecta COMPLETE=${complete}, PARTIAL=${partial}, CAPABILITY_ONLY=${capabilityOnly}.`,
);

if (crossServerFindings.length === 0) {
  fail('Expected at least one cross-server candidate finding, got none.');
}

if (crossServerComplete.length > 0) {
  fail(`Cross-server findings must not be TRIFECTA_COMPLETE; found ${crossServerComplete.length}.`);
}

if (crossServerPartial.length === 0) {
  fail('Expected at least one cross-server TRIFECTA_PARTIAL finding.');
}

const crossServerPairs = Array.from(
  new Set(crossServerPartial.map((finding) => `${finding.sourceServerId ?? 'unknown'}->${finding.sinkServerId ?? 'unknown'}`)),
);
console.log(`✅ Cross-server partial found: ${crossServerPartial.length}. Pairs: ${crossServerPairs.join(', ')}.`);
JS

echo "ℹ️  Cleanup command:"
echo "   ${DC[*]} -f docker-compose.yml -f ${COMPOSE_OVERRIDE} down -v"
