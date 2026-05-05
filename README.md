# ISeeMP — I See Model Paths 🔍

![ISeeMP Logo](iseemap-logo.png)

> ISeeMP shows what your AI system can actually be made to do.

ISeeMP maps execution paths in MCP/agent tooling environments. It answers the question: _what can a model be made to do through the available tools and context?_

It classifies tool capabilities with deterministic rules (no LLM required), builds a graph of possible source→context→sink paths, detects **lethal trifecta** conditions, and can validate selected paths with deterministic canary tests. Everything is stored locally in SQLite.

**Example path:**

```
READ_SECRET_HIGH -> MODEL_CONTEXT -> SEND_EXTERNAL
```

Static detection shows _possible_ paths. Deterministic tests confirm whether a controlled path _actually executes_.

## Table of Contents

- [Why this matters](#why-this-matters)
- [What it does](#what-it-does)
- [How to read ISeeMP results](#how-to-read-iseemp-results)
- [Lethal trifecta model](#lethal-trifecta-model)
- [Prerequisites](#prerequisites)
- [Quickstart](#quickstart)
- [Damn Vulnerable MCP demo (dv-mcp)](#damn-vulnerable-mcp-demo-dv-mcp)
- [Secure vs vulnerable demo contrast](#secure-vs-vulnerable-demo-contrast)
- [End-to-end local demo (safe fixture)](#end-to-end-local-demo-safe-fixture)
- [Filesystem MCP e2e scripts](#filesystem-mcp-e2e-scripts)
- [Docker (local-first)](#docker-local-first)
- [Web UI screenshots](#web-ui-screenshots)
- [Architecture](#architecture)
- [Capability model](#capability-model)
- [Risk categories](#risk-categories)
- [Configuration discovery](#configuration-discovery)
- [CLI reference](#cli-reference)
- [HTTP API reference](#http-api-reference)
- [Data model (SQLite)](#data-model-sqlite)
- [Development](#development)
- [Monorepo layout](#monorepo-layout)
- [Troubleshooting](#troubleshooting)
- [Safety notes](#safety-notes)

## Why this matters

MCP tool ecosystems compose risk across tools and servers. Inventorying what tools exist is not enough — the critical question is whether a **source** (sensitive data read), **model context** (untrusted instruction influence), and **sink** (external communication or mutation) form a connected path.

ISeeMP makes those paths visible, testable, and explainable.

## What it does

ISeeMP traces causal chains in AI tooling environments:

- **Deterministic capability classification** — classifies every tool by what it can do (read secrets, send data, mutate state, etc.) using name/description/schema heuristics; no LLM involved
- **Path analysis** — builds a graph of source→context→sink paths across tools and servers; detects lethal trifecta conditions
- **Graph view** — structural model path view with highlighted lethal trifecta paths
- **Deterministic test profiles** — validates selected paths using canary injection; records whether the path was confirmed, rejected, or inconclusive
- **Evidence and logs** — redacted tool-call records and a diagnostic timeline for every collection, analysis, and test run

Unlike scanners that only inventory capabilities, ISeeMP highlights chained risk across tools and servers.

## How to read ISeeMP results

After running `collect`, `analyze`, and optionally `test`, open the web UI at `http://localhost:7474`:

| View          | What it shows                                                                        |
| ------------- | ------------------------------------------------------------------------------------ |
| **Dashboard** | Summary: servers, tools, findings, exploitable paths, prompt-injection confirmations |
| **Findings**  | Security conclusions grouped by trifecta stage and severity                          |
| **Graph**     | Structural model path view; lethal trifecta paths are highlighted                    |
| **Logs**      | Diagnostic timeline showing why a collection, analysis, or test succeeded or failed  |
| **Evidence**  | Redacted tool-call and canary records attached to tested findings                    |

Start with **Findings** to understand what ISeeMP concluded. Use **Graph** to see the structural path. Use **Logs** and **Evidence** to understand why a path was confirmed or rejected.

## Lethal trifecta model

A **lethal trifecta** is a complete source→context→sink path:

| Leg                                  | What it means                                                | ISeeMP capability examples                          |
| ------------------------------------ | ------------------------------------------------------------ | --------------------------------------------------- |
| 1. Private data access               | A tool can read sensitive or secret data                     | `READ_SECRET_HIGH`, `READ_CREDENTIAL_HIGH`          |
| 2. Untrusted content influence       | A tool exposes the model to attacker-controlled instructions | `UNTRUSTED_CONTENT_EXPOSURE`, `INSTRUCTION_SOURCE`  |
| 3. External communication / mutation | A tool can send data out or mutate remote state              | `SEND_EXTERNAL`, `SEND_HTTP`, `MUTATE_REMOTE_STATE` |

### Trifecta status

| Status              | Meaning                                                                                |
| ------------------- | -------------------------------------------------------------------------------------- |
| `TRIFECTA_COMPLETE` | Structural source/context/sink path is present                                         |
| `TRIFECTA_PARTIAL`  | One or more relevant pieces are present but the full path is not structurally complete |
| `CAPABILITY_ONLY`   | Standalone risky capability not currently part of a structural path                    |

### Test states

| State                 | Meaning                                                                   |
| --------------------- | ------------------------------------------------------------------------- |
| `TESTED_CONFIRMED`    | Canary marker was observed at the sink — the path executed                |
| `TESTED_REJECTED`     | Execution was proven blocked or impossible                                |
| `TESTED_INCONCLUSIVE` | Path ran but the canary was not observed; neither confirmed nor ruled out |

**"Possible" is not the same as "confirmed."** Static detection identifies structural risk. Only a deterministic canary test can confirm a path actually executes end-to-end.

## Prerequisites

- Node.js `>=20`
- pnpm `>=9`
- Docker (for the dv-mcp e2e demo and the Docker workflow)

## Quickstart

The recommended path for new users is to start with a local demo fixture — no credentials or external services required.

```sh
# 1) Clone and install
git clone https://github.com/goldjg/i-see-mp.git
cd i-see-mp
corepack enable
corepack prepare pnpm@latest --activate
pnpm install

# 2) Build everything
pnpm build

# 3) Run the safe local fixture (no credentials needed)
pnpm --filter safe-mcp build

cat > iseemp.config.json << 'EOF_CONF'
{
  "mcpServers": {
    "safe-mcp": {
      "command": "node",
      "args": ["examples/safe-mcp/dist/index.js"]
    }
  }
}
EOF_CONF

node packages/cli/dist/index.js collect --config iseemp.config.json
node packages/cli/dist/index.js analyze
node packages/cli/dist/index.js serve --port 7474
# Open http://localhost:7474

# 4) (Optional) Run the deliberately vulnerable demo — see "Damn Vulnerable MCP demo" section below

# 5) (Optional) Analyze your own MCP servers — set up iseemp.config.json with your servers
#    GitHub PAT is only required when targeting GitHub MCP servers
```

## Damn Vulnerable MCP demo (dv-mcp)

> ⚠️ **`dv-mcp` is deliberately vulnerable. It exists for local controlled testing only.**
> Do not expose it as a real service. It uses only synthetic fake secrets and canary values.

`examples/dv-mcp` is a local demo fixture that demonstrates a **full lethal trifecta** in a controlled lab environment:

```
UNTRUSTED_CONTENT_EXPOSURE -> MODEL_CONTEXT -> READ_SECRET_HIGH -> SEND_EXTERNAL
```

Tools in the fixture:

| Tool                      | Role                                                                 |
| ------------------------- | -------------------------------------------------------------------- |
| `dv_get_untrusted_prompt` | Source — returns a synthetic attacker-controlled instruction payload |
| `dv_read_secret`          | Source — returns a synthetic fake secret (no real credential)        |
| `dv_send_external`        | Sink — HTTP POST to a localhost-only webhook URL                     |
| `dv_update_issue`         | Sink — fake remote mutation (no real call performed)                 |

### Recommended: run the e2e script

The `scripts/dv-mcp-e2e.sh` script is the simplest way to run the full demo. It requires Docker.

```sh
# Run the full dv-mcp e2e demo (builds, collects, analyzes, tests, asserts)
bash scripts/dv-mcp-e2e.sh

# Keep the UI running after the script completes for manual inspection
ISEEMP_DV_KEEP_UP=1 bash scripts/dv-mcp-e2e.sh
# Open http://localhost:7474
```

Expected outcomes:

- `TESTED_CONFIRMED` — canary observed at the sink
- `canaryObserved: true` on the `dv-lethal-trifecta` test run
- `lethalTrifectaStatus: CONFIRMED` on at least one finding
- Findings, Graph, Logs, and Evidence all show the path and proof

### Manual step-by-step (no Docker)

If you prefer to run without Docker, use these explicit commands from the repo root:

```sh
# 1) Build the fixture
pnpm --filter dv-mcp install --frozen-lockfile
pnpm --filter dv-mcp build

# 2) Write the dv-mcp config
cat > iseemp.dv-mcp.config.json << 'EOF_CONF'
{
  "mcpServers": {
    "dv-mcp": {
      "transport": "stdio",
      "command": "node",
      "args": ["examples/dv-mcp/dist/index.js"]
    }
  }
}
EOF_CONF

# 3) Build ISeeMP (if not already built)
pnpm build

# 4) Collect + analyze
node packages/cli/dist/index.js collect --config iseemp.dv-mcp.config.json
node packages/cli/dist/index.js analyze

# 5) Run the dv-lethal-trifecta test profile
node packages/cli/dist/index.js test --profile dv-lethal-trifecta

# 6) Serve the UI
node packages/cli/dist/index.js serve --port 7474
# Open http://localhost:7474 → Findings, Graph, Logs, Evidence
```

Expected test output includes:

```
lethal trifecta: CONFIRMED 1
canary observed: true
path status: tested_confirmed
```

## Secure vs vulnerable demo contrast

ISeeMP can show both **risk** and **control effectiveness**:

| Scenario                             | What happens                                                                                                                                                                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Safe/default fixture**             | Fetch or private-address protections may block unsafe delivery. The path may be structurally possible or influenced but the canary is not observed — `TESTED_REJECTED` or `TESTED_INCONCLUSIVE`. This demonstrates that controls are working. |
| **dv-mcp (deliberately vulnerable)** | The fixture intentionally permits the controlled source-to-sink flow. The canary is observed at the localhost sink. The lethal trifecta is confirmed — `TESTED_CONFIRMED`.                                                                    |

This contrast matters: ISeeMP does not only flag risk. It can confirm that a path is genuinely blocked when controls are in place.

## End-to-end local demo (safe fixture)

Use the deterministic `examples/safe-mcp` server to validate the full ISeeMP flow locally against a server with known-safe tools.

```sh
# Build the safe fixture
pnpm --filter safe-mcp build

# Create a local config that points to the fixture
cat > iseemp.config.json << 'EOF_CONF'
{
  "mcpServers": {
    "safe-mcp": {
      "command": "node",
      "args": ["examples/safe-mcp/dist/index.js"]
    }
  }
}
EOF_CONF

# Build, collect, analyze, serve
pnpm build
node packages/cli/dist/index.js collect --config iseemp.config.json
node packages/cli/dist/index.js analyze
node packages/cli/dist/index.js serve --port 7474
```

## Run the demo fixture

Use the bundled deterministic demo fixture in `examples/demo-mcp-server`.

```sh
# Build demo fixture + write iseemp.demo.config.json
node packages/cli/dist/index.js demo up

# Collect, analyze, test, and serve
node packages/cli/dist/index.js demo collect
node packages/cli/dist/index.js analyze
node packages/cli/dist/index.js demo test
node packages/cli/dist/index.js serve --port 7474
```

Expected demo-confirm tested outcomes:

- `TESTED_CONFIRMED`: `READ_SECRET_HIGH -> MODEL_CONTEXT -> SEND_EXTERNAL` (canary observed)
- `TESTED_REJECTED`: `READ_METADATA_LOW -> MODEL_CONTEXT -> SEND_EXTERNAL` (blocked sink path)
- `TESTED_INCONCLUSIVE`: `AGENT -> MUTATE_REMOTE_STATE` (dry-run mutation acknowledged only)

## Filesystem MCP e2e scripts

Run these conservative e2e scripts from repo root:

```sh
# Filesystem-only source sanity check
bash scripts/filesystem-mcp-e2e.sh

# Filesystem + Fetch cross-server composition sanity check
bash scripts/filesystem-fetch-mcp-e2e.sh

# Filesystem + Fetch + GitHub cross-domain composition sanity check
# Optional canary run when vars are set:
#   GITHUB_PERSONAL_ACCESS_TOKEN, ISEEMP_TEST_REPO_OWNER, ISEEMP_TEST_REPO_NAME
bash scripts/filesystem-fetch-github-mcp-e2e.sh
```

Expected outcomes:

- `filesystem-mcp-e2e.sh`: filesystem-only is source-only; zero exploitable paths is the correct passing result.
- `filesystem-fetch-mcp-e2e.sh`: filesystem tools should classify as local source capability and fetch tools as network/external interaction capability.
- `filesystem-fetch-github-mcp-e2e.sh`: validates three-server trust partitioning across filesystem (local), fetch (HTTP-capable), and GitHub (remote read/mutation), including cross-server metadata integrity.
- Cross-server trifecta is reported if current graph/rules synthesize it, but not required for pass.

## Docker (local-first)

Run the API/UI/CLI fully local in Docker (no SaaS required for the deterministic demo).

```sh
# Build + start ISeeMP API/UI on http://localhost:7474
docker compose up -d

# Prepare bundled deterministic demo fixture config in-container
docker compose exec iseemp iseemp demo up

# Collect, analyze, and run deterministic demo tests
docker compose exec iseemp iseemp demo collect
docker compose exec iseemp iseemp analyze
docker compose exec iseemp iseemp demo test
```

SQLite data is persisted in the named volume `iseemp_data` at `/data/iseemp.db`.

### GitHub MCP sidecar in Docker Compose

`docker-compose.yml` runs a sibling `github-mcp` container from `ghcr.io/github/github-mcp-server` in HTTP mode:

```yaml
github-mcp:
  image: ghcr.io/github/github-mcp-server
  command: ['http', '--port', '8082']
```

- Required env var for GitHub collection/testing: `GITHUB_PERSONAL_ACCESS_TOKEN`
- Optional env vars: `GITHUB_TOOLSETS` (defaults to `all`), `GITHUB_HOST` (for GHES / ghe.com)
- Transport note: the sidecar speaks MCP over streamable HTTP on the internal Compose network; `iseemp` connects to `http://github-mcp:8082/` and forwards `GITHUB_PERSONAL_ACCESS_TOKEN` as a bearer token instead of spawning a stdio child inside the app container

Useful commands:

```sh
# Tail logs
docker compose logs -f iseemp

# Stop services
docker compose down

# Stop and remove DB volume
docker compose down -v
```

## Web UI screenshots

These screenshots were generated via Playwright.

### Dashboard

![Dashboard](docs/screenshots/dashboard.png)

### Graph

![Graph](docs/screenshots/graph.png)

### Tools

![Tools](docs/screenshots/tools.png)

### Findings

![Findings](docs/screenshots/findings.png)

### Findings — all expanded (with trifecta classification guide)

All finding cards expanded and trifecta classification guide open, including test evidence and tool-call details for the CONFIRMED lethal trifecta finding.

![Findings expanded](docs/screenshots/findings-expanded.png)

### Graph — highlighted path

Graph view after clicking **Show on graph →** on the top CONFIRMED finding, with the affected path nodes highlighted.

![Graph highlighted](docs/screenshots/graph-highlighted.png)

### Logs

![Logs](docs/screenshots/logs.png)

### Logs — filtered to finding (with expanded detail rows)

Logs view after clicking **Show logs →** on the CONFIRMED finding, with all available detail rows expanded.

![Logs finding](docs/screenshots/logs-finding.png)

## Architecture

```mermaid
graph TD
  CLI[iseemp CLI] -->|collect| Collector
  Collector -->|MCP SDK stdio/SSE| MCPServer[MCP Server]
  Collector -->|classify capabilities| Rules[Capability Classifier]
  Collector -->|persist| Storage[(SQLite)]
  CLI -->|analyze| Graph[Graph Builder]
  Graph -->|reads| Storage
  Graph -->|run rules| FindingsEngine[Findings Engine]
  FindingsEngine -->|writes| Storage
  CLI -->|serve| API[Fastify API]
  API -->|reads| Storage
  API -->|serves static| WebUI[React UI]
  WebUI -->|Cytoscape.js| AttackGraph[Attack Graph View]
```

## Capability model

ISeeMP classifies tools using name/description/schema heuristics. Capabilities are now grouped by intent, so GitHub-style tools like `search_repositories`, `add_reply_to_pull_request_comment`, or `pull_request_review_write` are no longer flagged as code execution.

**Execution (only true shell/code-eval tools)**

| Capability     | Description                                | Risk |
| -------------- | ------------------------------------------ | ---- |
| `RUN_SHELL`    | Executes shell/OS commands or subprocesses | 95   |
| `EXECUTE_CODE` | Evaluates code in an interpreter / REPL    | 90   |

**Reads (sensitivity tiers)**

| Capability              | Description                                         | Risk |
| ----------------------- | --------------------------------------------------- | ---- |
| `READ_CREDENTIAL_HIGH`  | Real credentials/tokens/passwords/API keys/env vars | 85   |
| `READ_SECRET_HIGH`      | Secrets / vault contents                            | 80   |
| `READ_SECRET`           | (legacy alias for READ_SECRET_HIGH)                 | 80   |
| `READ_SENSITIVE_MEDIUM` | Team/org/collaborator metadata                      | 55   |
| `READ_LOCAL_FILE`       | Read local filesystem                               | 30   |
| `READ_REMOTE_DATA`      | Read from remote sources                            | 25   |
| `READ_METADATA_LOW`     | Public metadata (releases, tags, labels)            | 15   |

**Writes / mutation**

| Capability              | Description                                | Risk |
| ----------------------- | ------------------------------------------ | ---- |
| `MUTATE_IDENTITY`       | IAM, roles, permissions                    | 80   |
| `MUTATE_CLOUD_RESOURCE` | AWS/Azure/GCP resources                    | 75   |
| `MUTATE_REPOSITORY`     | Create/delete/push to a remote repo        | 65   |
| `WRITE_LOCAL_FILE`      | Write to local filesystem                  | 55   |
| `WRITE_REMOTE_DATA`     | Write to remote systems                    | 50   |
| `MUTATE_REMOTE_STATE`   | Generic remote state mutation              | 45   |
| `MUTATE_ISSUE_OR_PR`    | Create/edit issues, PRs, comments, reviews | 40   |

**Network / send**

| Capability      | Description                                           | Risk |
| --------------- | ----------------------------------------------------- | ---- |
| `SEND_EXTERNAL` | Send data to a destination outside the trust boundary | 65   |
| `SEND_EMAIL`    | Send email                                            | 60   |
| `SEND_HTTP`     | Make HTTP requests                                    | 55   |

**Query**

| Capability            | Description                              | Risk |
| --------------------- | ---------------------------------------- | ---- |
| `QUERY_DATABASE`      | Execute SQL queries                      | 50   |
| `QUERY_REMOTE_SYSTEM` | Read-only search/list/get on remote SaaS | 20   |

**Other**

| Capability      | Description                        | Risk |
| --------------- | ---------------------------------- | ---- |
| `EXPORT_DATA`   | Bulk export/dump                   | 70   |
| `CREATE_TICKET` | Create issues/PRs/tickets (legacy) | 35   |
| `UNKNOWN`       | Unclassified                       | 10   |

## Trust boundaries

Each MCP server is annotated with a `trustBoundary`:

- `LOCAL` — stdio servers, or HTTP servers on localhost
- `INTERNAL` — internal network (heuristic, currently unused)
- `EXTERNAL` — non-localhost HTTP server, not a known SaaS
- `SAAS` — known SaaS host (`github.com`, `gitlab.com`, `slack.com`, …)
- `UNKNOWN`

Findings prefer paths that cross trust boundaries, especially `LOCAL`/`INTERNAL` → `SAAS`/`EXTERNAL` data movement.

## Risk categories

| Category                  | Description                                                      |
| ------------------------- | ---------------------------------------------------------------- |
| `DATA_EXFILTRATION`       | Path from sensitive read → external send (across trust boundary) |
| `PRIVILEGED_MUTATION`     | Remote-state mutation tools exposed to the agent                 |
| `CODE_EXECUTION`          | Tools with real shell/code execution capability                  |
| `TRUST_BOUNDARY_CROSSING` | Server hosted at non-localhost URL                               |
| `SENSITIVE_DATA_EXPOSURE` | Tools that can read secrets/credentials/sensitive metadata       |
| `UNVERIFIED_SERVER`       | Server not cryptographically verified                            |
| `OVERBROAD_TOOL`          | Single tool with 4+ capabilities                                 |
| `DANGEROUS_TOOL_CHAIN`    | Server has multiple capabilities forming a risky path            |

Findings now also carry: `confidence`, `staticPossible` / `observed` / `tested`, `sourceCapabilities`, `sinkCapabilities`, `boundaryCrossed`, and `pathSummary` (e.g. `READ_SECRET_HIGH -> MODEL_CONTEXT -> SEND_EXTERNAL (SAAS)`).

## Configuration discovery

Discovery order:

1. `--config <path>` explicit config
2. `iseemp.config.json` in current directory
3. Claude Desktop config
4. VS Code settings (`mcpServers` key)
5. `--server <url>` single remote server

Config format (Claude Desktop compatible):

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["server.js"],
      "env": { "API_KEY": "..." }
    },
    "remote-server": {
      "url": "https://api.example.com/mcp/sse"
    }
  }
}
```

## CLI reference

```text
iseemp collect  [--config <path>] [--server <url>] [--db <path>]
iseemp analyze  [--collection <id>] [--db <path>]
iseemp test     [--collection <id>] [--profile <name>] [--db <path>]
iseemp demo up
iseemp demo collect  [--db <path>]
iseemp demo test     [--collection <id>] [--db <path>]
iseemp serve    [--port <n>] [--db <path>]
iseemp --help
```

### Command behavior

- `collect` — discovers MCP servers, inventories tools/resources/prompts, and persists results
- `analyze` — builds graph edges/nodes and runs findings rules
- `test` — runs the deterministic test profile against the latest collection
- `demo up` — builds `examples/demo-mcp-server` and writes `iseemp.demo.config.json`
- `demo collect` — runs collection against the bundled demo fixture config
- `demo test` — runs `--profile demo-confirm` with deterministic confirmed/rejected/inconclusive outcomes
- `serve` — starts Fastify API and serves web UI (if `apps/web/dist` exists)

### Test profiles

| Profile                   | Scope                 | Purpose                                                                                 |
| ------------------------- | --------------------- | --------------------------------------------------------------------------------------- |
| `safe`                    | Any server            | Canary-based tests for common risky paths; uses a local mock sink                       |
| `demo-confirm`            | Demo fixture          | Deterministic confirmed/rejected/inconclusive outcomes against the bundled demo         |
| `github-safe-canary`      | GitHub MCP servers    | High-fidelity controlled tests against a disposable GitHub repo                         |
| `prompt-injection-github` | GitHub MCP servers    | Prompt-injection detection via GitHub content channels                                  |
| `prompt-injection-fetch`  | Fetch MCP servers     | Prompt-injection detection via HTTP fetch channels                                      |
| `prompt-injection-db`     | DB-capable servers    | Prompt-injection detection via database content channels                                |
| `dv-lethal-trifecta`      | `dv-mcp` fixture only | Full source→context→sink path confirmation in the deliberately vulnerable local fixture |

#### `dv-lethal-trifecta`

Scoped exclusively to `dv-mcp`. Injects a canary into the untrusted-content source and validates that it reaches the external send sink. Expected outcome: `TESTED_CONFIRMED` with `canaryObserved: true`. Uses a localhost-only sink managed by the test harness — no real external traffic.

```sh
node packages/cli/dist/index.js test --profile dv-lethal-trifecta
```

### Testing the canary fixture end-to-end

```bash
pnpm --filter canary-mcp build

cat > iseemp.config.json <<'EOF'
{
  "mcpServers": {
    "canary-mcp": { "command": "node", "args": ["examples/canary-mcp/dist/index.js"] }
  }
}
EOF

node packages/cli/dist/index.js collect && \
node packages/cli/dist/index.js analyze && \
node packages/cli/dist/index.js test --profile safe
```

### GitHub high-fidelity safe-canary profile

> ⚠️ `github-safe-canary` performs controlled writes to a **disposable** GitHub repository.
> Do not point it at production repositories. Only target repositories created specifically for canary testing.

Required permissions for the GitHub MCP token: read repository contents/metadata; create/update/delete test files and branches; create/update/close test issues.

```bash
node packages/cli/dist/index.js collect --config iseemp.config.json
node packages/cli/dist/index.js analyze
node packages/cli/dist/index.js test \
  --profile github-safe-canary \
  --test-repo-owner octo-org \
  --test-repo-name canary-sandbox \
  --test-branch-prefix iseemp-canary- \
  --test-issue-prefix ISEEMP-CANARY- \
  --test-canary-prefix ISEEMP-CANARY
```

Expected outcomes in this profile:

- `TESTED_CONFIRMED` only when the unique canary marker is observed in expected controlled artifacts
- `TESTED_REJECTED` only when execution is proven blocked or impossible
- `TESTED_INCONCLUSIVE` when marker is absent without proof of blockage
- `TEST_SKIPPED` when required permissions/tools are missing

When using Docker Compose, write the GitHub server entry as:

```json
{
  "mcpServers": {
    "github": {
      "url": "http://github-mcp:8082/",
      "transport": "http"
    }
  }
}
```

## HTTP API reference

| Endpoint                                    | Method | Description                                    |
| ------------------------------------------- | ------ | ---------------------------------------------- |
| `/health`                                   | GET    | Liveness and timestamp                         |
| `/collections`                              | GET    | List collections                               |
| `/servers?collectionId=...`                 | GET    | Servers for collection (latest by default)     |
| `/tools?collectionId=...&serverId=...`      | GET    | Tools for collection (latest by default)       |
| `/graph?collectionId=...`                   | GET    | Graph nodes/edges (persisted or built on read) |
| `/findings?collectionId=...`                | GET    | Findings for collection                        |
| `/test-runs?collectionId=...&findingId=...` | GET    | Test runs for collection or finding            |
| `/test-runs/:id`                            | GET    | Single test run with attached evidence         |
| `/evidence/:testRunId`                      | GET    | Evidence records for a test run                |
| `/logs`                                     | GET    | Diagnostic log entries (paginated)             |

#### `/logs` query parameters

| Parameter      | Description                                                    |
| -------------- | -------------------------------------------------------------- |
| `collectionId` | Filter by collection                                           |
| `findingId`    | Filter by finding                                              |
| `testRunId`    | Filter by test run                                             |
| `serverId`     | Filter by server                                               |
| `toolId`       | Filter by tool                                                 |
| `phase`        | Filter by phase: `collect`, `analyze`, `test`, `serve`, `demo` |
| `level`        | Filter by level: `info`, `warn`, `error`                       |
| `q`            | Free-text search across log messages                           |
| `limit`        | Page size (1–500, default 100)                                 |
| `offset`       | Pagination offset (default 0)                                  |

## Data model (SQLite)

Primary tables:

- `collections`
- `servers`
- `tools`
- `resources`
- `prompts`
- `nodes`
- `edges`
- `findings`
- `test_runs` — one row per tested path; stores `pathStatus`, `canaryObserved`, `toolCalls`, and test metadata
- `evidence` — redacted tool-call records attached to test runs
- `logs` — diagnostic timeline for every phase; queryable via `/logs` API

## Development

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

## Monorepo layout

```text
apps/web              React + Vite + Cytoscape.js UI
apps/api              Fastify API server
packages/core         Shared types + Zod schemas
packages/collector    Config discovery + MCP client
packages/graph        Graph builder + attack-path queries
packages/storage      SQLite schema + typed repositories
packages/rules        Capability classifier + findings rules
packages/tester       Deterministic test runner + profile registry
packages/cli          iseemp CLI entry point
examples/safe-mcp     Deterministic MCP fixture with known-safe tools
examples/dv-mcp       Deliberately vulnerable fixture for lethal trifecta demo
```

## Troubleshooting

- **UI returns empty data**
  - Run `collect` first, then `analyze`.
  - Confirm your `--db` path is the same across commands.
- **`serve` says web UI is not built**
  - Run `pnpm --filter @iseemp/web build`.
- **Config not discovered**
  - Pass explicit `--config` path to remove ambiguity.
- **Remote server issues**
  - Verify URL/transport and credentials for that server.

## Safety notes

- **Local-first storage** — all data is stored in a local SQLite file; no automatic outbound data export.
- **Secret redaction** — secrets in config env vars are redacted before storage; evidence and log records are redacted before being written.
- **dv-mcp is intentionally vulnerable** — `examples/dv-mcp` is a deliberate lab fixture. Do not expose it outside a local controlled environment. It uses only synthetic fake secrets and localhost-restricted sinks.
- **Remote collection uses metadata only** — `collect` calls `listTools`, `listResources`, and `listPrompts`; it does not invoke tools.
- **`github-safe-canary` requires a disposable repository** — this profile performs controlled writes. Only target repositories created specifically for canary testing; never point it at production repos.
- **`safe` profile is read-only by default** — uses a local mock webhook sink; no real external traffic.
