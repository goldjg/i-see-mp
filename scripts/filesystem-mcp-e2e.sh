#!/usr/bin/env bash
#
# End-to-end driver for validating generic (non-GitHub) MCP behavior using
# the official filesystem MCP server over stdio.
#
# Semantic contract (filesystem-only profile):
#   - Proves source-only local capability classification without an external sink.
#   - Servers: exactly 1 filesystem server.
#   - Tools: at least 1 tool; must include READ_LOCAL_FILE.
#   - Capability families: local read/write only; no SEND_EXTERNAL/SEND_HTTP/SEND_EMAIL.
#   - Structural trifecta: no COMPLETE findings.
#   - Trust transitions: none expected (single-server scenario).
#   - Trust-boundary crossing: none expected.
#   - Lethal trifecta: no POSSIBLE/CONFIRMED findings.
#   - Prompt injection: no confirmed injection findings.
#   - Canary gating: not applicable.
#
# What it does:
#   1. Installs @modelcontextprotocol/server-filesystem into /tmp.
#   2. Creates a safe local fixture directory under /tmp.
#   3. Writes a runtime docker compose override that bind-mounts fixture + server package.
#   4. Rebuilds and starts only the iseemp service.
#   5. Writes a stdio MCP config in-container for the filesystem server.
#   6. Runs `iseemp collect` and `iseemp analyze`.
#   7. Asserts expected generic outcomes through API checks.
#
# Expected outcome notes:
#   - Filesystem-only is source-only for local read/write context.
#   - Zero exploitable paths is a PASS condition when no external sink server exists.

set -euo pipefail

SERVICE="${ISEEMP_COMPOSE_SERVICE:-iseemp}"
API_PORT="${ISEEMP_API_PORT:-7474}"
READY_TIMEOUT="${ISEEMP_READY_TIMEOUT_SECS:-60}"
FIXTURE_DIR="${ISEEMP_FS_FIXTURE_DIR:-/tmp/fs-fixture}"
FSMCP_PKG_DIR="${ISEEMP_FS_MCP_PKG_DIR:-/tmp/fs-mcp-pkg}"
FSMCP_MOUNT_PATH="${ISEEMP_FS_MCP_MOUNT_PATH:-/tmp/fs-mcp-pkg}"
FSMCP_BIN_NAME="mcp-server-filesystem"
FSMCP_NPM_PACKAGE="@modelcontextprotocol/server-filesystem"
FSMCP_NPM_VERSION="${ISEEMP_FS_MCP_NPM_VERSION:-2026.1.14}"
FSMCP_GLOB_OVERRIDE_VERSION="${ISEEMP_FS_MCP_GLOB_OVERRIDE_VERSION:-13.0.0}"
NPM_INSTALL_NODE_IMAGE="${ISEEMP_NPM_INSTALL_NODE_IMAGE:-node:20-bookworm-slim}"
FSMCP_BIN_IN_CONTAINER="${FSMCP_MOUNT_PATH}/node_modules/.bin/${FSMCP_BIN_NAME}"
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

npm_install_prefix_in_node_image() {
  local prefix="$1"
  shift
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    --volume "${prefix}:/work" \
    --workdir /work \
    "$NPM_INSTALL_NODE_IMAGE" \
    npm install --no-audit --no-fund "$@"
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

echo "▶ Installing filesystem MCP package (${FSMCP_NPM_PACKAGE}@${FSMCP_NPM_VERSION}) into ${FSMCP_PKG_DIR}…"
rm -rf "$FSMCP_PKG_DIR"
mkdir -p "$FSMCP_PKG_DIR"
cat > "${FSMCP_PKG_DIR}/package.json" <<JSON
{
  "name": "iseemp-filesystem-mcp-runtime",
  "private": true,
  "dependencies": {
    "${FSMCP_NPM_PACKAGE}": "${FSMCP_NPM_VERSION}"
  },
  "overrides": {
    "glob": "${FSMCP_GLOB_OVERRIDE_VERSION}"
  }
}
JSON
npm_install_prefix_in_node_image "$FSMCP_PKG_DIR"
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

echo "▶ Running topology-selected deterministic profiles…"
"${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" exec -T \
  -e "ISEEMP_API_PORT=${API_PORT}" \
  "$SERVICE" node - <<'JS'
(async () => {
  const apiPort = process.env.ISEEMP_API_PORT || '7474';
  const { spawnSync } = await import('node:child_process');
  const testerModulePath = process.env.ISEEMP_TESTER_MODULE || '/app/packages/tester/dist/index.js';
  const tester = await import(testerModulePath);
  const { selectProfilesForTopology, E2E_PROFILE_DESCRIPTORS } = tester;

  async function getJson(path) {
    const res = await fetch(`http://127.0.0.1:${apiPort}${path}`);
    if (!res.ok) throw new Error(`API ${path} returned HTTP ${res.status}`);
    return res.json();
  }

  const [servers, tools] = await Promise.all([getJson('/servers'), getJson('/tools')]);
  const { selected, skipped } = selectProfilesForTopology(
    servers.map((s) => ({ id: s.id, name: s.name })),
    tools.map((t) => ({
      serverId: t.serverId,
      capabilities: Array.isArray(t.capabilities) ? t.capabilities : [],
    })),
    E2E_PROFILE_DESCRIPTORS,
    { hasCredentials: false },
  );
  const uniqueSelected = [];
  const seenTypes = new Set();
  for (const descriptor of selected) {
    if (seenTypes.has(descriptor.profileType)) continue;
    seenTypes.add(descriptor.profileType);
    uniqueSelected.push(descriptor);
  }

  console.log(`🧪 profiles planned: ${selected.length}`);
  console.log(`🧪 profiles skipped: ${skipped.length}`);
  for (const item of skipped) console.log(`⚠️  SKIPPED: ${item.profileId} — ${item.reason}`);

  let passed = 0;
  let failed = 0;
  for (const descriptor of uniqueSelected) {
    console.log(`▶ profile run: ${descriptor.profileId} (${descriptor.profileType})`);
    const result = spawnSync('iseemp', ['test', '--profile', descriptor.profileType], {
      stdio: 'inherit',
      env: process.env,
    });
    if (result.status === 0) passed += 1;
    else failed += 1;
  }
  console.log(`🧪 profiles run: ${uniqueSelected.length}`);
  console.log(`🧪 profiles passed: ${passed}`);
  console.log(`🧪 profiles failed: ${failed}`);
  if (failed > 0) process.exit(1);
})().catch((err) => {
  console.error(`❌ Profile execution failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
JS

echo "▶ Validating tools/findings expectations through API…"
"${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" exec -T \
  -e "ISEEMP_API_PORT=${API_PORT}" \
  "$SERVICE" node - <<'JS'
const apiPort = process.env.ISEEMP_API_PORT || '7474';

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

/*
Semantic contract enforced by this block:
- servers: exactly 1 filesystem
- tools: at least 1 with READ_LOCAL_FILE
- capabilities: no external send capabilities
- trifecta/lethal/injection: no complete chain, no POSSIBLE/CONFIRMED lethal, no confirmed injection
- trust: no external/saas boundary crossings
- note: /findings payload is enriched via applyTrifectaAnalysis in the API.
*/
function assertHasServer(servers, name) {
  const server = servers.find((candidate) => candidate.name === name);
  if (!server) fail(`Server '${name}' not detected.`);
  return server;
}

function assertHasCapability(tools, serverId, capability) {
  const match = tools.some(
    (tool) =>
      tool.serverId === serverId &&
      Array.isArray(tool.capabilities) &&
      tool.capabilities.includes(capability),
  );
  if (!match) fail(`Expected capability '${capability}' on server '${serverId}'.`);
}

function assertHasTrustTransition(findings, from, to) {
  const expected = `${from} → ${to}`;
  const finding = findings.find((candidate) => candidate.trustTransition === expected);
  if (!finding) fail(`Expected trust transition '${expected}'.`);
  return finding;
}

function assertAcceptableTrustTransitions(finding, allowedTransitions) {
  if (!finding) fail('Expected finding for trust-transition assertion.');
  if (!allowedTransitions.includes(finding.trustTransition)) {
    fail(
      `Expected trust transition in [${allowedTransitions.join(', ')}], got ${finding.trustTransition ?? 'undefined'}.`,
    );
  }
}

function assertLethalTrifectaCounts(findings, opts) {
  const confirmed = findings.filter((finding) => finding.lethalTrifectaStatus === 'CONFIRMED').length;
  const possible = findings.filter((finding) => finding.lethalTrifectaStatus === 'POSSIBLE').length;
  if (typeof opts.confirmedMax === 'number' && confirmed > opts.confirmedMax) {
    fail(`Unexpected lethalTrifectaStatus=CONFIRMED findings: ${confirmed} (max ${opts.confirmedMax}).`);
  }
  if (typeof opts.possibleMax === 'number' && possible > opts.possibleMax) {
    fail(`Unexpected lethalTrifectaStatus=POSSIBLE findings: ${possible} (max ${opts.possibleMax}).`);
  }
}

function assertNoConfirmedInjection(findings) {
  const confirmed = findings.filter((finding) => finding.injectionConfirmed === true);
  if (confirmed.length > 0) fail(`Unexpected injectionConfirmed=true finding(s): ${confirmed.length}.`);
}

function assertCrossServerSourceSinkIntegrity(crossServerFindings) {
  for (const finding of crossServerFindings) {
    if (typeof finding.sourceServerId !== 'string' || typeof finding.sinkServerId !== 'string') {
      fail(`Cross-server finding missing sourceServerId/sinkServerId: ${finding.id}`);
    }
    if (finding.sourceServerId.length === 0 || finding.sinkServerId.length === 0) {
      fail(`Cross-server finding has empty sourceServerId/sinkServerId: ${finding.id}`);
    }
    if (finding.sourceServerId === finding.sinkServerId) {
      fail(`Cross-server finding has identical source/sink server IDs: ${finding.id}`);
    }
  }
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

// /findings includes applyTrifectaAnalysis output (trifecta/trust/lethal fields) from the API.
// This profile is source-only by design: zero exfil and zero complete chains is a PASS signal.
if (servers.length !== 1) fail(`Expected exactly 1 server, got ${servers.length}.`);
const filesystemServer = assertHasServer(servers, 'filesystem');
if (filesystemServer.transport !== 'stdio') {
  fail(`Expected stdio transport, got '${filesystemServer.transport ?? 'unknown'}'.`);
}
if (filesystemServer.url) {
  fail(`Expected URL to be absent for stdio transport, got '${filesystemServer.url}'.`);
}

if (tools.length < 1) fail('Expected at least 1 tool.');
const sendCaps = new Set(['SEND_EXTERNAL', 'SEND_HTTP', 'SEND_EMAIL']);
assertHasCapability(tools, filesystemServer.id, 'READ_LOCAL_FILE');

const sendCapTools = tools.filter((tool) =>
  Array.isArray(tool.capabilities) && tool.capabilities.some((cap) => sendCaps.has(cap)),
);
if (sendCapTools.length > 0) {
  fail(`Unexpected external-send capability on tools: ${sendCapTools.map((tool) => tool.name).join(', ')}`);
}
// Finding count is intentionally unconstrained for filesystem-only source scenarios.

const exfilFindings = findings.filter((finding) => finding.category === 'DATA_EXFILTRATION');
if (exfilFindings.length > 0) fail('Unexpected DATA_EXFILTRATION finding(s).');

const trifectaFindings = findings.filter((finding) => finding.trifectaComplete === true);
if (trifectaFindings.length > 0) fail('Unexpected trifectaComplete=true finding(s).');

assertLethalTrifectaCounts(findings, { confirmedMax: 0, possibleMax: 0 });
assertNoConfirmedInjection(findings);

const externalBoundaryFindings = findings.filter(
  (finding) => finding.boundaryCrossed === 'EXTERNAL' || finding.boundaryCrossed === 'SAAS',
);
if (externalBoundaryFindings.length > 0) fail('Unexpected EXTERNAL/SAAS boundary crossing findings.');

console.log(
  `✅ Filesystem MCP e2e passed. Servers: ${servers.length}. Tools: ${tools.length}. Findings: ${findings.length}. No external sink or trifecta detected.`,
);
JS

echo "ℹ️  Cleanup command:"
echo "   ${DC[*]} -f docker-compose.yml -f ${COMPOSE_OVERRIDE} down -v"
