#!/usr/bin/env bash
#
# End-to-end driver for validating conservative multi-server composition between:
#   - filesystem MCP (local source/mutation capabilities)
#   - fetch MCP (network interaction capabilities)
#   - github MCP over HTTP sidecar (remote read/mutation capabilities)
#
# Semantic contract (filesystem-fetch-github profile):
#   - Proves multi-server trust-zone-aware classification under current trust semantics.
#   - Servers: at least 3 (filesystem, fetch, github).
#   - Tools: at least 1 per server.
#   - Capability families: filesystem READ_LOCAL_FILE; fetch SEND_HTTP/READ_REMOTE_DATA;
#     github READ_REMOTE_DATA/WRITE_REMOTE_DATA/MUTATE_REMOTE_RESOURCE.
#   - Structural trifecta: cross-server findings must remain PARTIAL (not COMPLETE).
#   - Trust transitions: include LOCAL → EXTERNAL and LOCAL → CONTROLLED_SAAS or LOCAL → USER_CONTROLLED_SAAS.
#   - Trust-boundary crossing: required for filesystem → fetch; filesystem → github depends on github tool trust zone.
#   - Lethal trifecta: POSSIBLE may appear; CONFIRMED forbidden.
#   - Prompt injection: no confirmed injection findings.
#   - Canary gating: optional github-safe-canary based on env vars.
#
# The goal is trust-domain classification sanity, not exploit confirmation.

set -euo pipefail

SERVICE="${ISEEMP_COMPOSE_SERVICE:-iseemp}"
API_PORT="${ISEEMP_API_PORT:-7474}"
READY_TIMEOUT="${ISEEMP_READY_TIMEOUT_SECS:-60}"
FIXTURE_DIR="${ISEEMP_FS_FETCH_GITHUB_FIXTURE_DIR:-/tmp/fs-fetch-github-fixture}"
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
CONFIG_PATH_IN_CONTAINER="/data/iseemp.filesystem-fetch-github.config.json"
COMPOSE_OVERRIDE="${ISEEMP_FS_FETCH_GITHUB_COMPOSE_OVERRIDE:-/tmp/compose-fs-fetch-github-e2e-override.yml}"
GITHUB_MCP_READY_PATH="${GITHUB_MCP_READY_PATH:-/.well-known/oauth-protected-resource}"
BRANCH_PREFIX="${ISEEMP_TEST_BRANCH_PREFIX:-iseemp-canary-}"
ISSUE_PREFIX="${ISEEMP_TEST_ISSUE_PREFIX:-ISEEMP-CANARY-}"
CANARY_PREFIX="${ISEEMP_TEST_CANARY_PREFIX:-ISEEMP-CANARY}"
FETCH_FIXTURE_PID=""
RUN_GITHUB_CANARY="false"

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

validate_compose_path "$FIXTURE_DIR" "ISEEMP_FS_FETCH_GITHUB_FIXTURE_DIR"
validate_compose_path "$FSMCP_PKG_DIR" "ISEEMP_FS_MCP_PKG_DIR"
validate_compose_path "$FETCHMCP_PKG_DIR" "ISEEMP_FETCH_MCP_PKG_DIR"
validate_compose_path "$FSMCP_MOUNT_PATH" "ISEEMP_FS_MCP_MOUNT_PATH"
validate_compose_path "$FETCHMCP_MOUNT_PATH" "ISEEMP_FETCH_MCP_MOUNT_PATH"
validate_compose_path "$FETCH_FIXTURE_SCRIPT_IN_CONTAINER" "FETCH_FIXTURE_SCRIPT_IN_CONTAINER"
validate_compose_path "$CONFIG_PATH_IN_CONTAINER" "CONFIG_PATH_IN_CONTAINER"
validate_compose_path "$COMPOSE_OVERRIDE" "ISEEMP_FS_FETCH_GITHUB_COMPOSE_OVERRIDE"
validate_absolute_path_no_traversal "$FSMCP_MOUNT_PATH" "ISEEMP_FS_MCP_MOUNT_PATH"
validate_absolute_path_no_traversal "$FETCHMCP_MOUNT_PATH" "ISEEMP_FETCH_MCP_MOUNT_PATH"
validate_absolute_path_no_traversal "$FETCH_FIXTURE_SCRIPT_IN_CONTAINER" "FETCH_FIXTURE_SCRIPT_IN_CONTAINER"
validate_absolute_path_no_traversal "$CONFIG_PATH_IN_CONTAINER" "CONFIG_PATH_IN_CONTAINER"
validate_absolute_path_no_traversal "$COMPOSE_OVERRIDE" "ISEEMP_FS_FETCH_GITHUB_COMPOSE_OVERRIDE"
validate_tmp_delete_target "$FIXTURE_DIR" "ISEEMP_FS_FETCH_GITHUB_FIXTURE_DIR"
validate_tmp_delete_target "$FSMCP_PKG_DIR" "ISEEMP_FS_MCP_PKG_DIR"
validate_tmp_delete_target "$FETCHMCP_PKG_DIR" "ISEEMP_FETCH_MCP_PKG_DIR"

if [[ -n "${GITHUB_PERSONAL_ACCESS_TOKEN:-}" && -n "${ISEEMP_TEST_REPO_OWNER:-}" && -n "${ISEEMP_TEST_REPO_NAME:-}" ]]; then
  RUN_GITHUB_CANARY="true"
else
  echo "ℹ️  Skipping github-safe-canary (GITHUB_PERSONAL_ACCESS_TOKEN / ISEEMP_TEST_REPO_OWNER / ISEEMP_TEST_REPO_NAME not all set)."
fi

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
printf 'ISEEMP-FETCH-GITHUB-FIXTURE-CANARY\n' > "${FIXTURE_DIR}/canary.txt"
printf '{"fixture":"filesystem-fetch-github","safe":true}\n' > "${FIXTURE_DIR}/metadata.json"

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

echo "▶ Starting full stack (including github-mcp sidecar)…"
"${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" up -d

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

echo "▶ Waiting for github-mcp sidecar HTTP endpoint…"
deadline=$(( $(date +%s) + READY_TIMEOUT ))
while :; do
  if "${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" exec -T "$SERVICE" \
      node -e "fetch('http://github-mcp:8082${GITHUB_MCP_READY_PATH}').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))" \
      >/dev/null 2>&1; then
    echo "▶ github-mcp is ready."
    break
  fi
  if (( $(date +%s) >= deadline )); then
    echo "❌ Timed out waiting for github-mcp sidecar readiness." >&2
    "${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" logs --tail=200 github-mcp >&2 || true
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

FETCH_FIXTURE_PID="$("${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" exec -T "$SERVICE" \
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

echo "▶ Writing combined filesystem+fetch+github MCP config to ${CONFIG_PATH_IN_CONTAINER}…"
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
    },
    "github": {
      "url": "http://github-mcp:8082/",
      "transport": "http"
    }
  }
}
JSON

run_iseemp() {
  if [[ -n "${GITHUB_PERSONAL_ACCESS_TOKEN:-}" ]]; then
    "${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" exec -T \
      -e "GITHUB_PERSONAL_ACCESS_TOKEN=${GITHUB_PERSONAL_ACCESS_TOKEN}" \
      "$SERVICE" iseemp "$@"
  else
    "${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" exec -T \
      "$SERVICE" iseemp "$@"
  fi
}

echo "▶ iseemp collect (filesystem + fetch + github MCP)…"
run_iseemp collect --config "${CONFIG_PATH_IN_CONTAINER}"

echo "▶ iseemp analyze…"
run_iseemp analyze

echo "▶ Running topology-selected deterministic profiles…"
"${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" exec -T \
  -e "GITHUB_PERSONAL_ACCESS_TOKEN=${GITHUB_PERSONAL_ACCESS_TOKEN:-}" \
  -e "ISEEMP_API_PORT=${API_PORT}" \
  -e "ISEEMP_HAS_CREDENTIALS=${RUN_GITHUB_CANARY}" \
  -e "ISEEMP_E2E_INCLUDE_UNSAFE=${ISEEMP_E2E_INCLUDE_UNSAFE_PROFILES:-false}" \
  -e "ISEEMP_TEST_REPO_OWNER=${ISEEMP_TEST_REPO_OWNER:-}" \
  -e "ISEEMP_TEST_REPO_NAME=${ISEEMP_TEST_REPO_NAME:-}" \
  -e "ISEEMP_TEST_BRANCH_PREFIX=${BRANCH_PREFIX}" \
  -e "ISEEMP_TEST_ISSUE_PREFIX=${ISSUE_PREFIX}" \
  -e "ISEEMP_TEST_CANARY_PREFIX=${CANARY_PREFIX}" \
  "$SERVICE" node - <<'JS'
(async () => {
  const apiPort = process.env.ISEEMP_API_PORT || '7474';
  const hasCredentials = process.env.ISEEMP_HAS_CREDENTIALS === 'true';
  const includeUnsafe = process.env.ISEEMP_E2E_INCLUDE_UNSAFE === 'true';
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
    { hasCredentials, includeUnsafe },
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
    const args = ['test', '--profile', descriptor.profileType];
    if (descriptor.profileType === 'github-safe-canary' || descriptor.profileType === 'prompt-injection-github') {
      args.push(
        '--test-repo-owner', process.env.ISEEMP_TEST_REPO_OWNER ?? '',
        '--test-repo-name', process.env.ISEEMP_TEST_REPO_NAME ?? '',
        '--test-branch-prefix', process.env.ISEEMP_TEST_BRANCH_PREFIX ?? '',
        '--test-issue-prefix', process.env.ISEEMP_TEST_ISSUE_PREFIX ?? '',
        '--test-canary-prefix', process.env.ISEEMP_TEST_CANARY_PREFIX ?? '',
      );
    }
    console.log(`▶ profile run: ${descriptor.profileId} (${descriptor.profileType})`);
    const result = spawnSync('iseemp', args, { stdio: 'inherit', env: process.env });
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

echo "▶ Validating filesystem+fetch+github classification and cross-server expectations through API…"
"${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" exec -T \
  -e "ISEEMP_API_PORT=${API_PORT}" \
  -e "ISEEMP_EXPECT_GITHUB_CANARY=${RUN_GITHUB_CANARY}" \
  -e "ISEEMP_E2E_INCLUDE_UNSAFE=${ISEEMP_E2E_INCLUDE_UNSAFE_PROFILES:-false}" \
  "$SERVICE" node - <<'JS'
const apiPort = process.env.ISEEMP_API_PORT || '7474';
const expectGithubCanary = process.env.ISEEMP_EXPECT_GITHUB_CANARY === 'true';
const includeUnsafe = process.env.ISEEMP_E2E_INCLUDE_UNSAFE === 'true';

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

/*
Semantic contract enforced by this block:
- servers: at least filesystem + fetch + github
- tools: at least 1 per server with expected capability families
- structural trifecta: cross-server findings present and PARTIAL (not COMPLETE)
- trust: LOCAL → EXTERNAL must exist; filesystem → github allows LOCAL → CONTROLLED_SAAS or LOCAL → USER_CONTROLLED_SAAS
- trust boundary: required for filesystem → fetch; filesystem → github depends on transition zone
- lethal/injection: POSSIBLE allowed in constrained cases; CONFIRMED and confirmed injection forbidden
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

function isTestedConfirmedWithCanary(run) {
  if (!run || run.canaryObserved !== true) return false;
  if (run.pathStatus === 'tested_confirmed') return true;
  return run.outcome === 'TESTED_CONFIRMED';
}

function assertInjectionConfirmationRequiresDeviation(findings, testRuns) {
  const confirmedInjectionFindings = findings.filter((finding) => finding.injectionConfirmed === true);
  if (confirmedInjectionFindings.length === 0) return;
  const hasBehaviouralDeviationEvidence = testRuns.some((run) => run.deviationDetected === true);
  if (!hasBehaviouralDeviationEvidence) {
    fail(
      `injectionConfirmed=true requires behavioural deviation evidence, but no deviating test runs were recorded.`,
    );
  }
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

const [servers, tools, findings, testRuns] = await Promise.all([
  getJson('/servers'),
  getJson('/tools'),
  getJson('/findings'),
  getJson('/test-runs'),
]);
// /findings includes applyTrifectaAnalysis output (trifecta/trust/lethal fields) from the API.

if (servers.length < 3) fail(`Expected at least 3 servers, got ${servers.length}.`);
if (tools.length === 0) fail('Zero tools detected.');

const filesystemServer = assertHasServer(servers, 'filesystem');
const fetchServer = assertHasServer(servers, 'fetch');
const githubServer = assertHasServer(servers, 'github');

const filesystemTools = tools.filter((tool) => tool.serverId === filesystemServer.id);
const fetchTools = tools.filter((tool) => tool.serverId === fetchServer.id);
const githubTools = tools.filter((tool) => tool.serverId === githubServer.id);
if (filesystemTools.length === 0) fail('No tools discovered for filesystem server.');
if (fetchTools.length === 0) fail('No tools discovered for fetch server.');
if (githubTools.length === 0) fail('No tools discovered for GitHub server.');

const hasCap = (tool, cap) => Array.isArray(tool.capabilities) && tool.capabilities.includes(cap);

assertHasCapability(tools, filesystemServer.id, 'READ_LOCAL_FILE');
const hasFilesystemLocalRead = filesystemTools.some((tool) => hasCap(tool, 'READ_LOCAL_FILE'));

const hasFetchNetwork = fetchTools.some(
  (tool) => hasCap(tool, 'SEND_HTTP') || hasCap(tool, 'READ_REMOTE_DATA'),
);
if (!hasFetchNetwork) fail('Fetch server has no SEND_HTTP or READ_REMOTE_DATA classification.');

const hasGithubRemote = githubTools.some(
  (tool) =>
    hasCap(tool, 'READ_REMOTE_DATA') ||
    hasCap(tool, 'WRITE_REMOTE_DATA') ||
    hasCap(tool, 'MUTATE_REMOTE_RESOURCE'),
);
if (!hasGithubRemote) {
  fail('GitHub server has no READ_REMOTE_DATA, WRITE_REMOTE_DATA, or MUTATE_REMOTE_RESOURCE tools.');
}

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
const lethalPossibleFindings = findings.filter((finding) => finding.lethalTrifectaStatus === 'POSSIBLE');
const crossServerFindings = findings.filter((finding) => finding.isCrossServer === true);
const crossServerPartial = crossServerFindings.filter((finding) => finding.trifectaStage === 'PARTIAL');
const crossServerComplete = crossServerFindings.filter((finding) => finding.trifectaComplete === true);
const trustBoundaryCrossings = crossServerFindings.filter(
  (finding) => finding.crossesTrustBoundary === true,
);

console.log(
  `✅ Filesystem+Fetch+GitHub MCP e2e summary. Servers: ${servers.length}. Tools: ${tools.length}. Findings: ${findings.length}. Trifecta COMPLETE=${complete}, PARTIAL=${partial}, CAPABILITY_ONLY=${capabilityOnly}.`,
);

if (crossServerFindings.length === 0) {
  fail('Expected at least one cross-server candidate finding, got none.');
}

if (crossServerComplete.length > 0) {
  // Keep this as a warning so e2e does not hard-code current trifecta stage policy.
  console.warn(`⚠️ Cross-server findings marked TRIFECTA_COMPLETE: ${crossServerComplete.length}.`);
}

assertLethalTrifectaCounts(findings, { confirmedMax: 0 });

const githubHasUntrustedContent = githubTools.some((tool) => hasCap(tool, 'UNTRUSTED_CONTENT_EXPOSURE'));
const fetchHasUntrustedContent = fetchTools.some((tool) => hasCap(tool, 'UNTRUSTED_CONTENT_EXPOSURE'));
const fetchHasExternalComm = fetchTools.some(
  (tool) => hasCap(tool, 'SEND_EXTERNAL') || hasCap(tool, 'SEND_HTTP') || hasCap(tool, 'SEND_EMAIL'),
);
if (!githubHasUntrustedContent) {
  const invalidCandidates = lethalPossibleFindings.filter(
    (finding) =>
      !(
        fetchHasUntrustedContent &&
        hasFilesystemLocalRead &&
        fetchHasExternalComm &&
        finding.sourceServerId === filesystemServer.id &&
        finding.sinkServerId === fetchServer.id
      ),
  );
  if (invalidCandidates.length > 0) {
    fail(
      `Unexpected lethalTrifectaStatus=POSSIBLE findings without untrusted GitHub tools in scope: ${invalidCandidates.length}.`,
    );
  }
}

if (crossServerPartial.length === 0) {
  fail('Expected at least one cross-server TRIFECTA_PARTIAL finding.');
}
// Boundary crossings must be driven by filesystem → fetch (LOCAL → EXTERNAL), not necessarily filesystem → github.
if (trustBoundaryCrossings.length === 0) {
  fail('Expected at least one cross-server trust-boundary crossing finding.');
}
assertHasTrustTransition(crossServerFindings, 'LOCAL', 'EXTERNAL');

assertCrossServerSourceSinkIntegrity(crossServerFindings);

const hasFilesystemCrossServerPath = crossServerFindings.some(
  (finding) =>
    finding.sourceServerId === filesystemServer.id &&
    (finding.sinkServerId === fetchServer.id || finding.sinkServerId === githubServer.id),
);
if (!hasFilesystemCrossServerPath) {
  fail(
    `Expected at least one filesystem-origin cross-server finding to fetch/github. Filesystem=${filesystemServer.id}, fetch=${fetchServer.id}, github=${githubServer.id}.`,
  );
}

const filesystemToGithub = crossServerFindings.find(
  (finding) =>
    finding.sourceServerId === filesystemServer.id && finding.sinkServerId === githubServer.id,
);
if (!filesystemToGithub) {
  fail('Expected filesystem → github cross-server finding.');
}
assertAcceptableTrustTransitions(filesystemToGithub, [
  'LOCAL → CONTROLLED_SAAS',
  'LOCAL → USER_CONTROLLED_SAAS',
]);
if (filesystemToGithub.trustTransition === 'LOCAL → USER_CONTROLLED_SAAS') {
  if (filesystemToGithub.crossesTrustBoundary !== true) {
    fail('Expected filesystem → github to cross trust boundary for LOCAL → USER_CONTROLLED_SAAS.');
  }
} else if (filesystemToGithub.trustTransition === 'LOCAL → CONTROLLED_SAAS') {
  // LOCAL → CONTROLLED_SAAS keeps data in trusted/controlled zones only.
  if (filesystemToGithub.crossesTrustBoundary !== false) {
    fail('Expected filesystem → github not to cross trust boundary for LOCAL → CONTROLLED_SAAS.');
  }
} else {
  console.warn(
    `⚠️ Unhandled filesystem → github trust transition ${filesystemToGithub.trustTransition ?? 'undefined'}.`,
  );
}

const filesystemToFetch = crossServerFindings.find(
  (finding) =>
    finding.sourceServerId === filesystemServer.id && finding.sinkServerId === fetchServer.id,
);
if (!filesystemToFetch) {
  fail('Expected filesystem → fetch cross-server finding.');
}
if (filesystemToFetch.crossesTrustBoundary !== true) {
  fail('Expected filesystem → fetch to cross trust boundary.');
}
if (filesystemToFetch.trustTransition !== 'LOCAL → EXTERNAL') {
  fail(
    `Expected filesystem → fetch trust transition LOCAL → EXTERNAL, got ${filesystemToFetch.trustTransition ?? 'undefined'}.`,
  );
}

const githubToFetch = crossServerFindings.find(
  (finding) => finding.sourceServerId === githubServer.id && finding.sinkServerId === fetchServer.id,
);
if (githubToFetch && githubToFetch.crossesTrustBoundary !== true) {
  fail(
    'Expected github → fetch to cross trust boundary (CONTROLLED_SAAS/USER_CONTROLLED_SAAS → EXTERNAL).',
  );
}
assertInjectionConfirmationRequiresDeviation(findings, testRuns);
const testerModulePath = process.env.ISEEMP_TESTER_MODULE || '/app/packages/tester/dist/index.js';
const tester = await import(testerModulePath);
const { selectProfilesForTopology, E2E_PROFILE_DESCRIPTORS } = tester;
const { skipped } = selectProfilesForTopology(
  servers.map((s) => ({ id: s.id, name: s.name })),
  tools.map((t) => ({
    serverId: t.serverId,
    capabilities: Array.isArray(t.capabilities) ? t.capabilities : [],
  })),
  E2E_PROFILE_DESCRIPTORS,
  { hasCredentials: expectGithubCanary, includeUnsafe },
);
if (includeUnsafe) {
  const confirmedPromptInjectionRuns = testRuns.filter(
    (run) =>
      run.profile === 'prompt-injection-fetch' &&
      run.pathStatus === 'tested_confirmed' &&
      run.injectionConfirmed === true &&
      run.canaryObserved === true,
  );
  if (confirmedPromptInjectionRuns.length < 1) {
    fail('Expected at least one TESTED_CONFIRMED prompt-injection-fetch run with canaryObserved=true in unsafe run.');
  }
  const confirmedInjectionFindings = findings.filter((finding) => finding.injectionConfirmed === true);
  if (confirmedInjectionFindings.length < 1) {
    fail('Expected at least one finding with injectionConfirmed=true in unsafe run.');
  }
  const behaviouralDeviationCount = testRuns.filter((run) => run.deviationDetected === true).length;
  if (behaviouralDeviationCount < 1) {
    fail('Expected behavioralDeviation > 0 in unsafe run.');
  }
} else {
  const confirmedInjectionFindings = findings.filter((finding) => finding.injectionConfirmed === true);
  if (confirmedInjectionFindings.length > 0) {
    fail(`Unexpected injectionConfirmed=true findings in safe run: ${confirmedInjectionFindings.length}.`);
  }
  const confirmedInjectionRuns = testRuns.filter((run) => run.injectionConfirmed === true);
  if (confirmedInjectionRuns.length > 0) {
    fail(`Unexpected prompt-injection confirmed test runs in safe run: ${confirmedInjectionRuns.length}.`);
  }
  const skippedProfileIds = new Set(skipped.map((item) => item.profileId));
  const requiredSkipped = ['prompt-injection-github', 'prompt-injection-fetch'];
  const missing = requiredSkipped.filter((id) => !skippedProfileIds.has(id));
  if (missing.length > 0) {
    fail(`Expected prompt-injection profiles in skipped list during safe run: ${missing.join(', ')}`);
  }
}

if (expectGithubCanary) {
  const CANARY_CASE_IDS = new Set([
    'GITHUB_READ_CONTROLLED_ARTIFACT',
    'GITHUB_ISSUE_PR_WRITE_CONTROLLED_ARTIFACT',
  ]);
  const githubCanaryRuns = testRuns.filter(
    (run) => run.profile === 'github-safe-canary' || CANARY_CASE_IDS.has(run.testCaseId),
  );
  if (githubCanaryRuns.length === 0) {
    fail('Expected github-safe-canary test runs when github-safe-canary was enabled.');
  }
  const githubCanaryFailures = githubCanaryRuns.filter(
    (run) => run.outcome === 'TEST_ERROR' || run.outcome === 'TESTED_REJECTED',
  );
  if (githubCanaryFailures.length > 0) {
    fail(
      `Expected github-safe-canary profile to pass when enabled; found ${githubCanaryFailures.length} failed run(s).`,
    );
  }

  const githubCanaryConfirmedRuns = githubCanaryRuns.filter((run) => isTestedConfirmedWithCanary(run));

  const readSearchConfirmed = githubCanaryConfirmedRuns.some(
    (run) => run.testCaseId === 'GITHUB_READ_CONTROLLED_ARTIFACT',
  );
  if (!readSearchConfirmed) {
    fail('Expected TESTED_CONFIRMED + canaryObserved evidence for GitHub controlled read/search canary.');
  }

  const issueCommentPrConfirmed = githubCanaryConfirmedRuns.some(
    (run) => run.testCaseId === 'GITHUB_ISSUE_PR_WRITE_CONTROLLED_ARTIFACT',
  );
  if (!issueCommentPrConfirmed) {
    fail('Expected TESTED_CONFIRMED + canaryObserved evidence for GitHub issue/comment/PR write controls.');
  }
}

const crossServerPairs = Array.from(
  new Set(crossServerPartial.map((finding) => `${finding.sourceServerId}->${finding.sinkServerId}`)),
);
console.log(
  `✅ Cross-server partial found: ${crossServerPartial.length}. Pairs: ${crossServerPairs.join(', ')}.`,
);
JS

echo "ℹ️  Cleanup command:"
echo "   ${DC[*]} -f docker-compose.yml -f ${COMPOSE_OVERRIDE} down -v"
