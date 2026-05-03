#!/usr/bin/env bash
#
# End-to-end driver for validating conservative multi-server composition between:
#   - filesystem MCP (local source/mutation capabilities)
#   - fetch MCP (network interaction capabilities)
#   - github MCP over HTTP sidecar (remote read/mutation capabilities)
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

if [[ "$RUN_GITHUB_CANARY" == "true" ]]; then
  echo "▶ iseemp test --profile github-safe-canary…"
  run_iseemp test \
    --profile github-safe-canary \
    --test-repo-owner "${ISEEMP_TEST_REPO_OWNER}" \
    --test-repo-name "${ISEEMP_TEST_REPO_NAME}" \
    --test-branch-prefix "${BRANCH_PREFIX}" \
    --test-issue-prefix "${ISSUE_PREFIX}" \
    --test-canary-prefix "${CANARY_PREFIX}"
fi

echo "▶ Validating filesystem+fetch+github classification and cross-server expectations through API…"
"${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" exec -T \
  -e "ISEEMP_API_PORT=${API_PORT}" \
  -e "ISEEMP_EXPECT_GITHUB_CANARY=${RUN_GITHUB_CANARY}" \
  "$SERVICE" node - <<'JS'
const apiPort = process.env.ISEEMP_API_PORT || '7474';
const expectGithubCanary = process.env.ISEEMP_EXPECT_GITHUB_CANARY === 'true';

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

if (servers.length < 3) fail(`Expected at least 3 servers, got ${servers.length}.`);
if (tools.length === 0) fail('Zero tools detected.');

const filesystemServer = servers.find((server) => server.name === 'filesystem');
const fetchServer = servers.find((server) => server.name === 'fetch');
const githubServer = servers.find((server) => server.name === 'github');
if (!filesystemServer) fail('Filesystem server not detected.');
if (!fetchServer) fail('Fetch server not detected.');
if (!githubServer) fail('GitHub server not detected.');

const filesystemTools = tools.filter((tool) => tool.serverId === filesystemServer.id);
const fetchTools = tools.filter((tool) => tool.serverId === fetchServer.id);
const githubTools = tools.filter((tool) => tool.serverId === githubServer.id);
if (filesystemTools.length === 0) fail('No tools discovered for filesystem server.');
if (fetchTools.length === 0) fail('No tools discovered for fetch server.');
if (githubTools.length === 0) fail('No tools discovered for GitHub server.');

const hasCap = (tool, cap) => Array.isArray(tool.capabilities) && tool.capabilities.includes(cap);

const hasFilesystemLocalRead = filesystemTools.some((tool) => hasCap(tool, 'READ_LOCAL_FILE'));
if (!hasFilesystemLocalRead) fail('Filesystem server has no READ_LOCAL_FILE-classified tools.');

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
const lethalComplete = findings.filter((finding) => finding.lethalTrifectaStatus === 'COMPLETE');
const lethalCandidate = findings.filter((finding) => finding.lethalTrifectaStatus === 'CANDIDATE');
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

if (lethalComplete.length > 0) {
  fail(`Unexpected lethalTrifectaStatus=COMPLETE findings: ${lethalComplete.length}.`);
}

const githubHasUntrustedContent = githubTools.some((tool) => hasCap(tool, 'UNTRUSTED_CONTENT_EXPOSURE'));
const fetchHasUntrustedContent = fetchTools.some((tool) => hasCap(tool, 'UNTRUSTED_CONTENT_EXPOSURE'));
const fetchHasExternalComm = fetchTools.some(
  (tool) => hasCap(tool, 'SEND_EXTERNAL') || hasCap(tool, 'SEND_HTTP') || hasCap(tool, 'SEND_EMAIL'),
);
if (!githubHasUntrustedContent) {
  const invalidCandidates = lethalCandidate.filter(
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
      `Unexpected lethalTrifectaStatus=CANDIDATE findings without untrusted GitHub tools in scope: ${invalidCandidates.length}.`,
    );
  }
}

if (crossServerPartial.length === 0) {
  fail('Expected at least one cross-server TRIFECTA_PARTIAL finding.');
}
if (trustBoundaryCrossings.length === 0) {
  fail('Expected at least one cross-server trust-boundary crossing finding.');
}

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
if (filesystemToGithub.crossesTrustBoundary !== true) {
  fail('Expected filesystem → github to cross trust boundary.');
}
if (filesystemToGithub.trustTransition !== 'LOCAL → EXTERNAL') {
  fail(
    `Expected filesystem → github trust transition LOCAL → EXTERNAL, got ${filesystemToGithub.trustTransition ?? 'undefined'}.`,
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
if (githubToFetch && githubToFetch.crossesTrustBoundary !== false) {
  fail('Expected github → fetch to be cross-server but not a trust-boundary crossing.');
}

const badGithubCrossServer = findings.filter(
  (finding) =>
    finding.isCrossServer === true &&
    finding.sourceServerId === githubServer.id &&
    finding.sinkServerId === githubServer.id,
);
if (badGithubCrossServer.length > 0) {
  fail(
    `Same-server GitHub findings must not be marked cross-server; found ${badGithubCrossServer.length}.`,
  );
}

if (expectGithubCanary) {
  const githubServerNode = `server:${githubServer.id}`;
  const githubSameServerConfirmed = findings.filter(
    (finding) =>
      finding.isCrossServer !== true &&
      finding.pathStatus === 'tested_confirmed' &&
      Array.isArray(finding.affectedNodeIds) &&
      finding.affectedNodeIds.includes(githubServerNode),
  );
  if (githubSameServerConfirmed.length === 0) {
    fail('Expected at least one same-server GitHub tested_confirmed finding when github-safe-canary ran.');
  }

  const nonGithubConfirmed = findings.filter(
    (finding) =>
      finding.pathStatus === 'tested_confirmed' &&
      (!Array.isArray(finding.affectedNodeIds) || !finding.affectedNodeIds.includes(githubServerNode)),
  );
  if (nonGithubConfirmed.length > 0) {
    fail(
      `GitHub canary evidence should stay scoped to GitHub findings; found ${nonGithubConfirmed.length} tested_confirmed non-GitHub finding(s).`,
    );
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
