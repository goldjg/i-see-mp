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
