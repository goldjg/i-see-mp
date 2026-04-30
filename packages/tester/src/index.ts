import {
  getDb,
  createCollectionsRepo,
  createServersRepo,
  createToolsRepo,
  createTestRunsRepo,
  createEvidenceRepo,
  createFindingsRepo,
  testRunToRow,
  evidenceToRow,
  findingToRow,
} from '@iseemp/storage';
import type { ServerRow, ToolRow } from '@iseemp/storage';
import type { Finding, TestRun, Evidence } from '@iseemp/core';
import { Confidence, PathStatus, RiskCategory } from '@iseemp/core';
import { startMockSink } from './sink.js';
import {
  planSafeProfile,
  executePlannedTest,
  bumpConfidence,
  bumpSeverity,
  downgradeSeverity,
  downgradeConfidence,
  type PlannedTest,
} from './runner.js';
import { connectServer, callTool, type ConnectedServer } from './mcp-runtime.js';

export interface TestOptions {
  collectionId?: string;
  profile?: 'safe';
  dbPath?: string;
}

export interface TestSummary {
  collectionId: string;
  profile: 'safe';
  totalPlanned: number;
  confirmed: number;
  rejected: number;
  inconclusive: number;
  skipped: number;
  testRuns: TestRun[];
}

/**
 * Run the safe deterministic-test profile against the latest (or specified)
 * collection. This connects to each MCP server with a planned test, executes
 * the plan, persists test_runs + evidence, and updates the matching findings
 * to tested_confirmed / tested_rejected / tested_inconclusive.
 */
export async function runTests(options: TestOptions): Promise<TestSummary> {
  const profile = options.profile ?? 'safe';
  if (profile !== 'safe') {
    throw new Error(`Unknown test profile: ${profile}`);
  }

  const db = getDb(options.dbPath ?? 'iseemp.db');
  const collectionsRepo = createCollectionsRepo(db);
  const serversRepo = createServersRepo(db);
  const toolsRepo = createToolsRepo(db);
  const testRunsRepo = createTestRunsRepo(db);
  const evidenceRepo = createEvidenceRepo(db);
  const findingsRepo = createFindingsRepo(db);

  const col = options.collectionId
    ? collectionsRepo.findById(options.collectionId)
    : collectionsRepo.latest();
  if (!col) {
    throw new Error('No collection found. Run `iseemp collect` and `iseemp analyze` first.');
  }

  const servers = serversRepo.findByCollection(col.id);
  const tools = toolsRepo.findByCollection(col.id);
  const toolsByServer = new Map<string, ToolRow[]>();
  for (const t of tools) {
    const arr = toolsByServer.get(t.server_id) ?? [];
    arr.push(t);
    toolsByServer.set(t.server_id, arr);
  }

  const planned = planSafeProfile(servers, toolsByServer);
  if (planned.length === 0) {
    return {
      collectionId: col.id,
      profile,
      totalPlanned: 0,
      confirmed: 0,
      rejected: 0,
      inconclusive: 0,
      skipped: 0,
      testRuns: [],
    };
  }

  // Clear previous runs for this collection so re-runs are deterministic.
  testRunsRepo.deleteByCollection(col.id);

  const sink = await startMockSink();
  const connected = new Map<string, ConnectedServer>();
  const allTestRuns: TestRun[] = [];
  const allEvidence: Evidence[] = [];
  let skipped = 0;

  try {
    for (const p of planned) {
      const conn = await ensureConnection(connected, servers, p);
      if (!conn) { skipped++; continue; }

      const ctx = {
        collectionId: col.id,
        profile: 'safe' as const,
        invoke: async (_serverId: string, toolName: string, args: Record<string, unknown>) => {
          return callTool(conn.client, toolName, args);
        },
        sink,
      };

      const executed = await executePlannedTest(ctx, p);
      allTestRuns.push(executed.testRun);
      allEvidence.push(...executed.evidence);
    }
  } finally {
    for (const c of connected.values()) {
      try {
        await c.close();
      } catch {
        // ignore
      }
    }
    await sink.close();
  }

  // Persist test runs + evidence.
  testRunsRepo.insertMany(allTestRuns.map(testRunToRow));
  evidenceRepo.insertMany(allEvidence.map(evidenceToRow));

  // Update findings based on results.
  applyTestResultsToFindings(col.id, allTestRuns, planned, findingsRepo);

  const confirmed = allTestRuns.filter((r) => r.pathStatus === PathStatus.TESTED_CONFIRMED).length;
  const rejected = allTestRuns.filter((r) => r.pathStatus === PathStatus.TESTED_REJECTED).length;
  const inconclusive = allTestRuns.length - confirmed - rejected;

  return {
    collectionId: col.id,
    profile,
    totalPlanned: planned.length,
    confirmed,
    rejected,
    inconclusive,
    skipped,
    testRuns: allTestRuns,
  };
}

async function ensureConnection(
  connected: Map<string, ConnectedServer>,
  servers: ServerRow[],
  planned: PlannedTest,
): Promise<ConnectedServer | undefined> {
  if (connected.has(planned.serverId)) return connected.get(planned.serverId);
  const server = servers.find((s) => s.id === planned.serverId);
  if (!server) return undefined;

  let env: Record<string, string> | undefined;
  if (server.env) {
    try {
      const parsed = JSON.parse(server.env) as Record<string, string>;
      // Stored env is redacted; pass through known non-redacted values only.
      env = Object.fromEntries(
        Object.entries(parsed).filter(([, v]) => v && v !== '[redacted]'),
      );
      if (Object.keys(env).length === 0) env = undefined;
    } catch {
      env = undefined;
    }
  }

  let args: string[] | undefined;
  if (server.args) {
    try {
      args = JSON.parse(server.args) as string[];
    } catch {
      args = undefined;
    }
  }

  try {
    const conn = await connectServer({
      name: server.name,
      transport: server.transport as 'stdio' | 'http' | 'sse',
      command: server.command,
      args,
      env,
      url: server.url,
    });
    connected.set(planned.serverId, conn);
    return conn;
  } catch (err) {
    console.warn(`⚠️  Skipping server "${server.name}": ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/**
 * Update findings to reflect test outcomes.
 *
 * Rules:
 *  - tested_confirmed: bump confidence (one tier) and severity (one tier);
 *    set tested=true, observed=true, pathStatus=tested_confirmed.
 *  - tested_rejected:  downgrade severity one tier and lower confidence to low;
 *    set tested=true, observed=false, pathStatus=tested_rejected.
 *  - inconclusive: just mark tested=true, leave severity/confidence alone,
 *    pathStatus=tested_inconclusive.
 *  - static_possible (no test ran or no match): keep as-is.
 */
function applyTestResultsToFindings(
  collectionId: string,
  testRuns: TestRun[],
  planned: PlannedTest[],
  findingsRepo: ReturnType<typeof createFindingsRepo>,
): void {
  if (testRuns.length === 0) return;
  const findings = findingsRepo.findByCollection(collectionId);

  const updated: Finding[] = [];
  for (const finding of findings) {
    const matched = matchRunsToFinding(finding, planned, testRuns);
    if (matched.length === 0) continue;
    const newFinding = applyRunsToFinding(finding, matched);
    updated.push(newFinding);
  }

  if (updated.length > 0) {
    findingsRepo.insertMany(updated.map(findingToRow));
  }
}

function matchRunsToFinding(
  finding: Finding,
  planned: PlannedTest[],
  testRuns: TestRun[],
): TestRun[] {
  // Match by category + server membership (affectedNodeIds includes server:<id>).
  const targetServerIds = finding.affectedNodeIds
    .filter((n) => n.startsWith('server:'))
    .map((n) => n.slice('server:'.length));
  const targetToolIds = finding.affectedNodeIds
    .filter((n) => n.startsWith('tool:'))
    .map((n) => n.slice('tool:'.length));

  const out: TestRun[] = [];
  for (let i = 0; i < testRuns.length; i++) {
    const run = testRuns[i];
    const plan = planned[i];
    if (!run || !plan) continue;

    const serverMatches =
      targetServerIds.length === 0 || targetServerIds.includes(plan.serverId);
    const toolMatches =
      targetToolIds.length === 0 ||
      (plan.sourceTool && targetToolIds.includes(plan.sourceTool.id)) ||
      (plan.sinkTool && targetToolIds.includes(plan.sinkTool.id));

    if (!serverMatches || !toolMatches) continue;

    if (categoryMatches(finding.category, run.testCaseId)) {
      out.push(run);
    }
  }
  return out;
}

function categoryMatches(category: string, testCaseId: string): boolean {
  if (
    category === RiskCategory.DATA_EXFILTRATION &&
    (testCaseId === 'READ_SECRET_HIGH_TO_SEND_EXTERNAL' ||
      testCaseId === 'READ_SENSITIVE_MEDIUM_TO_SEND_EXTERNAL')
  ) {
    return true;
  }
  if (category === RiskCategory.SENSITIVE_DATA_EXPOSURE) {
    return (
      testCaseId === 'READ_SECRET_HIGH_TO_SEND_EXTERNAL' ||
      testCaseId === 'READ_SENSITIVE_MEDIUM_TO_SEND_EXTERNAL'
    );
  }
  if (category === RiskCategory.PRIVILEGED_MUTATION && testCaseId === 'MUTATE_REMOTE_STATE_EXPOSED') {
    return true;
  }
  return false;
}

function applyRunsToFinding(finding: Finding, runs: TestRun[]): Finding {
  const confirmed = runs.find((r) => r.pathStatus === PathStatus.TESTED_CONFIRMED);
  const rejected = runs.find((r) => r.pathStatus === PathStatus.TESTED_REJECTED);
  const next: Finding = {
    ...finding,
    tested: true,
    testRunIds: runs.map((r) => r.id),
  };

  if (confirmed) {
    next.observed = true;
    next.pathStatus = PathStatus.TESTED_CONFIRMED;
    next.confidence = bumpConfidence(finding.confidence);
    next.severity = bumpSeverity(finding.severity);
    next.staticPossible = true;
    next.explanation = appendExplanation(
      finding.explanation,
      `Test ${confirmed.testCaseId} confirmed this path: canary observed at the local mock sink (testRunId=${confirmed.id}).`,
    );
  } else if (rejected) {
    next.observed = false;
    next.pathStatus = PathStatus.TESTED_REJECTED;
    next.confidence = Confidence.LOW;
    next.severity = downgradeSeverity(finding.severity);
    next.explanation = appendExplanation(
      finding.explanation,
      `Test ${rejected.testCaseId} rejected this path: tool chain executed but canary was not observed (testRunId=${rejected.id}). Static finding downgraded.`,
    );
  } else {
    next.observed = false;
    next.pathStatus = PathStatus.TESTED_INCONCLUSIVE;
    next.confidence = downgradeConfidence(finding.confidence);
    next.explanation = appendExplanation(
      finding.explanation,
      `Test attempted but inconclusive (no canary signal); confidence downgraded, severity intact.`,
    );
  }

  return next;
}

function appendExplanation(prev: string | undefined, line: string): string {
  if (!prev) return line;
  return `${prev}\n${line}`;
}
