#!/usr/bin/env bash
#
# End-to-end driver for dv-mcp deterministic local lethal-trifecta demo.
#
# ⚠️  DELIBERATELY VULNERABLE DEMO FIXTURE — NOT FOR PRODUCTION USE.
# Local-only synthetic test path:
#   UNTRUSTED_CONTENT_EXPOSURE -> MODEL_CONTEXT -> READ_SECRET_HIGH -> SEND_EXTERNAL
# Canary observation is restricted to a localhost sink managed by the tester.
# No real secrets and no real external exfiltration are used.

set -euo pipefail

SERVICE="${ISEEMP_COMPOSE_SERVICE:-iseemp}"
API_PORT="${ISEEMP_API_PORT:-7474}"
READY_TIMEOUT="${ISEEMP_READY_TIMEOUT_SECS:-60}"
COMPOSE_OVERRIDE="${ISEEMP_DV_COMPOSE_OVERRIDE:-/tmp/compose-dv-mcp-e2e-override.yml}"
KEEP_UP="${ISEEMP_DV_KEEP_UP:-0}"
CONFIG_PATH_IN_CONTAINER="/data/iseemp.dv-mcp.config.json"

if docker compose version >/dev/null 2>&1; then
  DC=(docker compose)
elif docker-compose version >/dev/null 2>&1; then
  DC=(docker-compose)
else
  echo "❌ Neither 'docker compose' nor 'docker-compose' is available on PATH." >&2
  exit 1
fi

cleanup() {
  if [[ "$KEEP_UP" == "1" || "$KEEP_UP" == "true" || "$KEEP_UP" == "TRUE" ]]; then
    return
  fi
  "${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "▶ Writing compose override..."
cat >"$COMPOSE_OVERRIDE" <<YAML
services:
  ${SERVICE}:
    volumes:
      - ./examples/dv-mcp:/app/examples/dv-mcp
YAML

echo "▶ Rebuilding and starting ${SERVICE}..."
"${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" down -v
"${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" build --no-cache "$SERVICE"
"${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" up -d --no-deps "$SERVICE"

echo "▶ Waiting for API readiness..."
deadline=$(( $(date +%s) + READY_TIMEOUT ))
while :; do
  if "${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" exec -T "$SERVICE" \
    node -e "fetch('http://127.0.0.1:${API_PORT}/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
    >/dev/null 2>&1; then
    break
  fi
  if (( $(date +%s) >= deadline )); then
    echo "❌ Timed out waiting for API readiness." >&2
    "${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" logs --tail=200 "$SERVICE" >&2 || true
    exit 1
  fi
  sleep 2
done

echo "▶ Building dv-mcp fixture..."
"${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" exec -T "$SERVICE" \
  corepack pnpm --filter dv-mcp install --frozen-lockfile
"${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" exec -T "$SERVICE" \
  corepack pnpm --filter dv-mcp build

echo "▶ Writing dv-mcp MCP config..."
"${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" exec -T "$SERVICE" \
  sh -c "cat > ${CONFIG_PATH_IN_CONTAINER}" <<JSON
{
  "mcpServers": {
    "dv-mcp": {
      "transport": "stdio",
      "command": "node",
      "args": ["/app/examples/dv-mcp/dist/index.js"]
    }
  }
}
JSON

echo "▶ Collect + analyze..."
"${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" exec -T "$SERVICE" \
  iseemp collect --config "${CONFIG_PATH_IN_CONTAINER}"
"${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" exec -T "$SERVICE" \
  iseemp analyze

echo "▶ Assert PROMPT_INJECTION possible before test..."
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
const [servers, findings] = await Promise.all([getJson('/servers'), getJson('/findings')]);
const dvServer = servers.find((server) => server.name === 'dv-mcp');
if (!dvServer) fail('Expected server dv-mcp.');
const possiblePromptInjection = findings.some(
  (finding) =>
    finding.category === 'PROMPT_INJECTION' &&
    finding.lethalTrifectaStatus === 'POSSIBLE' &&
    Array.isArray(finding.affectedNodeIds) &&
    finding.affectedNodeIds.includes(`server:${dvServer.id}`),
);
if (!possiblePromptInjection) {
  fail('Expected PROMPT_INJECTION finding with lethalTrifectaStatus=POSSIBLE for dv-mcp.');
}
console.log('✅ Pre-test finding assertion passed.');
JS

echo "▶ Run dv-lethal-trifecta profile..."
"${DC[@]}" -f docker-compose.yml -f "$COMPOSE_OVERRIDE" exec -T "$SERVICE" \
  iseemp test --profile dv-lethal-trifecta

echo "▶ Assert confirmed lethal trifecta and localhost-only sink call..."
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
const [findings, testRuns] = await Promise.all([getJson('/findings'), getJson('/test-runs')]);
const confirmedLethal = findings.filter((finding) => finding.lethalTrifectaStatus === 'CONFIRMED');
if (confirmedLethal.length < 1) fail('Expected at least one lethalTrifectaStatus=CONFIRMED finding.');
const dvRuns = testRuns.filter((run) => run.profile === 'dv-lethal-trifecta');
if (dvRuns.length < 1) fail('Expected dv-lethal-trifecta test runs.');
const confirmedRun = dvRuns.find(
  (run) =>
    run.pathStatus === 'tested_confirmed' &&
    run.canaryObserved === true &&
    run.testCaseId === 'DV_LETHAL_TRIFECTA_END_TO_END',
);
if (!confirmedRun) fail('Expected confirmed dv-lethal-trifecta run with canaryObserved=true.');
const sinkCall = Array.isArray(confirmedRun.toolCalls)
  ? confirmedRun.toolCalls.find((call) => call.toolName === 'dv_send_external')
  : undefined;
if (!sinkCall) fail('Expected dv_send_external tool call in confirmed run.');
const sinkInput = JSON.stringify(sinkCall.input ?? {});
if (
  !sinkInput.includes('127.0.0.1') &&
  !sinkInput.includes('localhost') &&
  !sinkInput.includes('::1') &&
  !sinkInput.includes('[::1]')
) {
  fail('Expected dv_send_external sink input URL to be localhost-only.');
}
console.log('✅ Post-test assertions passed.');
JS

echo "✅ dv-mcp e2e completed successfully."
if [[ "$KEEP_UP" == "1" || "$KEEP_UP" == "true" || "$KEEP_UP" == "TRUE" ]]; then
  echo "ℹ️  Keeping ${SERVICE} running for UI inspection."
  echo "   Open UI: http://127.0.0.1:${API_PORT}"
  echo "   Teardown: ${DC[*]} -f docker-compose.yml -f ${COMPOSE_OVERRIDE} down -v"
fi
