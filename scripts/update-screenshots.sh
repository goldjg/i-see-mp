#!/usr/bin/env bash
#
# Regenerates docs/screenshots/*.png using Playwright + dv-mcp fixture.
#
# Usage:
#   bash scripts/update-screenshots.sh
#
# Requirements: Node.js >=20, pnpm >=9.
# Playwright Chromium is installed in a temp directory and removed afterwards.
# No Docker required; the dv-mcp fixture runs as a local stdio process.
#
# ⚠️  Uses the deliberately vulnerable dv-mcp fixture for demo data only.

set -euo pipefail

# Ensure pnpm is available via corepack
if ! command -v pnpm &>/dev/null; then
  corepack enable
  corepack prepare pnpm@latest --activate
fi

PNPM="${PNPM:-pnpm}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH="/tmp/iseemp-screenshots-$$.db"
CONFIG_PATH="/tmp/iseemp-screenshots-$$.config.json"
PORT=7476
API_URL="http://127.0.0.1:${PORT}"
PLAYWRIGHT_DIR="/tmp/iseemp-pw-$$"
SERVE_PID=""

cleanup() {
  if [[ -n "$SERVE_PID" ]]; then
    kill "$SERVE_PID" 2>/dev/null || true
  fi
  rm -rf "$PLAYWRIGHT_DIR" "$DB_PATH" "$CONFIG_PATH"
}
trap cleanup EXIT

cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# 1. Build
# ---------------------------------------------------------------------------
echo "▶ Building ISeeMP..."
$PNPM build

echo "▶ Building dv-mcp fixture..."
$PNPM --filter dv-mcp install --frozen-lockfile
$PNPM --filter dv-mcp build

# ---------------------------------------------------------------------------
# 2. Write dv-mcp config
# ---------------------------------------------------------------------------
cat >"$CONFIG_PATH" <<JSON
{
  "mcpServers": {
    "dv-mcp": {
      "transport": "stdio",
      "command": "node",
      "args": ["${REPO_ROOT}/examples/dv-mcp/dist/index.js"]
    }
  }
}
JSON

# ---------------------------------------------------------------------------
# 3. Collect → Analyze → Test
# ---------------------------------------------------------------------------
echo "▶ Collecting..."
node packages/cli/dist/index.js collect --config "$CONFIG_PATH" --db "$DB_PATH"

echo "▶ Analyzing..."
node packages/cli/dist/index.js analyze --db "$DB_PATH"

echo "▶ Testing (dv-lethal-trifecta)..."
node packages/cli/dist/index.js test --profile dv-lethal-trifecta --db "$DB_PATH"

# ---------------------------------------------------------------------------
# 4. Start serve
# ---------------------------------------------------------------------------
echo "▶ Starting serve on port $PORT..."
node packages/cli/dist/index.js serve --port "$PORT" --db "$DB_PATH" &
SERVE_PID=$!

echo "▶ Waiting for API readiness..."
for i in $(seq 1 30); do
  if curl -sf "${API_URL}/health" >/dev/null 2>&1; then
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "❌ API did not become ready in time" >&2
    exit 1
  fi
  sleep 1
done
echo "   API ready."

# ---------------------------------------------------------------------------
# 5. Install Playwright (Chromium only) in temp dir
# ---------------------------------------------------------------------------
echo "▶ Installing Playwright in temp dir..."
mkdir -p "$PLAYWRIGHT_DIR"
cd "$PLAYWRIGHT_DIR"
npm init -y >/dev/null
npm install --save-dev playwright >/dev/null 2>&1
PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_DIR/browsers" npx playwright install chromium 2>&1 | tail -3

# ---------------------------------------------------------------------------
# 6. Take screenshots
# ---------------------------------------------------------------------------
echo "▶ Taking screenshots..."
SCREENSHOT_DIR="${REPO_ROOT}/docs/screenshots"
mkdir -p "$SCREENSHOT_DIR"

PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_DIR/browsers" \
  node - "$API_URL" "$SCREENSHOT_DIR" <<'NODE_SCRIPT'
const { chromium } = await import('playwright');

const [,, baseUrl, outDir] = process.argv;
const VIEWPORT = { width: 1400, height: 900 };

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: VIEWPORT });
const page = await context.newPage();

async function waitForContent(selector, timeout = 15000) {
  await page.waitForSelector(selector, { timeout });
}

async function clickNav(label) {
  await page.click(`nav button:has-text("${label}")`);
  // Let React re-render settle
  await page.waitForTimeout(400);
}

// Navigate to the app
await page.goto(baseUrl, { waitUntil: 'networkidle' });

// ----- Dashboard -----
console.log('  📸 Dashboard...');
await waitForContent('.dashboard');
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}/dashboard.png`, fullPage: false });

// ----- Graph -----
console.log('  📸 Graph...');
await clickNav('Graph');
await waitForContent('.graph-container');
// Cytoscape needs extra time to finish layout
await page.waitForTimeout(3000);
await page.screenshot({ path: `${outDir}/graph.png`, fullPage: false });

// ----- Tools -----
console.log('  📸 Tools...');
await clickNav('Tools');
await waitForContent('.tools-view');
await page.waitForTimeout(600);
await page.screenshot({ path: `${outDir}/tools.png`, fullPage: false });

// ----- Findings -----
console.log('  📸 Findings...');
await clickNav('Findings');
await waitForContent('.findings-view');
await page.waitForTimeout(600);
await page.screenshot({ path: `${outDir}/findings.png`, fullPage: false });

// ----- Findings expanded -----
console.log('  📸 Findings expanded...');
// Open TrifectaLegend
const legendSummary = await page.$('details.trifecta-legend > summary');
if (legendSummary) await legendSummary.click();
await page.waitForTimeout(300);
// Expand every finding card
const headers = await page.$$('.finding-header');
for (const h of headers) { await h.click(); await page.waitForTimeout(200); }
// Wait for evidence to load (async)
await page.waitForTimeout(2500);
// Open all inner <details> (Plan, tool calls, etc.)
await page.evaluate(function() {
  document.querySelectorAll('.finding-body details').forEach(function(d) { d.open = true; });
});
await page.waitForTimeout(400);
await page.screenshot({ path: `${outDir}/findings-expanded.png`, fullPage: true });

// ----- Graph — highlighted path from top finding -----
console.log('  📸 Graph highlighted...');
const showGraphBtn = await page.$('.show-on-graph-btn');
if (showGraphBtn) {
  await showGraphBtn.click();
  await waitForContent('.graph-container');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${outDir}/graph-highlighted.png`, fullPage: false });
}

// ----- Logs — filtered to top finding -----
console.log('  📸 Logs (finding)...');
// Go back to Findings and expand the first (CONFIRMED) card to reach Show logs
await clickNav('Findings');
await waitForContent('.findings-view');
await page.waitForTimeout(600);
const firstHeader = await page.$('.finding-header');
if (firstHeader) { await firstHeader.click(); await page.waitForTimeout(2500); }
const showLogsBtn = await page.$('.show-logs-btn');
if (showLogsBtn) {
  await showLogsBtn.click();
  await waitForContent('.logs-view');
  await page.waitForTimeout(1500);
  // Expand all details in logs table
  await page.evaluate(function() {
    document.querySelectorAll('.logs-table details').forEach(function(d) { d.open = true; });
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${outDir}/logs-finding.png`, fullPage: true });
}

// ----- Graph — node detail panels for top finding -----
console.log('  📸 Graph node-click screenshots...');
// Navigate back to Findings, expand top card, click Show on graph
await clickNav('Findings');
await waitForContent('.findings-view');
await page.waitForTimeout(600);
const firstHeaderForGraph = await page.$('.finding-header');
if (firstHeaderForGraph) {
  await firstHeaderForGraph.click();
  await page.waitForTimeout(2500);
  const showGraphBtnForNodes = await page.$('.show-on-graph-btn');
  if (showGraphBtnForNodes) {
    await showGraphBtnForNodes.click();
    await waitForContent('.graph-container');
    await waitForContent('.cytoscape-canvas');
    await page.waitForTimeout(5000); // layout settle

    // Read affected node IDs from the API (top confirmed finding)
    const topFindingNodes = await page.evaluate(async function(apiBase) {
      const res = await fetch(apiBase + '/findings');
      const findings = await res.json();
      const confirmed = findings.filter(function(f) { return f.lethalTrifectaStatus === 'CONFIRMED'; });
      const top = confirmed.length > 0 ? confirmed[0] : findings[0];
      return top ? top.affectedNodeIds : [];
    }, baseUrl);

    const nodeSlugMap = {
      server: 'server',
      'dv_get_untrusted_prompt': 'tool-dv-get-untrusted-prompt',
      'dv_read_secret': 'tool-dv-read-secret',
      'dv_send_external': 'tool-dv-send-external',
    };

    for (let i = 0; i < topFindingNodes.length; i++) {
      const nodeId = topFindingNodes[i];
      // Derive a filesystem-safe slug from the node ID
      const parts = nodeId.split(':');
      const lastName = parts[parts.length - 1].replace(/[^a-z0-9_-]/gi, '-');
      const typePart = parts[0];
      const slug = typePart + '-' + lastName;
      const fname = `graph-node-${i + 1}-${slug}.png`;
      console.log(`    📸 ${fname}...`);

      const found = await page.evaluate(function(id) {
        var cy = document.querySelector('.cytoscape-canvas').__cy;
        if (!cy) return false;
        var node = cy.nodes().filter(function(n) { return n.id() === id; });
        if (node.length === 0) return false;
        node.emit('tap');
        return true;
      }, nodeId);

      if (!found) { console.warn('    ⚠ node not found: ' + nodeId); continue; }

      await page.waitForSelector('.node-detail-panel', { timeout: 5000 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${outDir}/${fname}`, fullPage: false });

      const closeBtn = await page.$('.node-detail-panel button');
      if (closeBtn) await closeBtn.click();
      await page.waitForTimeout(250);
    }
  }
}

// ----- Logs -----
console.log('  📸 Logs...');
await clickNav('Logs');
await waitForContent('.logs-view');
await page.waitForTimeout(600);
await page.screenshot({ path: `${outDir}/logs.png`, fullPage: false });

await browser.close();
console.log('  ✅ All screenshots saved.');
NODE_SCRIPT

echo "✅ Screenshots updated in docs/screenshots/"
ls -lh "${REPO_ROOT}/docs/screenshots/"
