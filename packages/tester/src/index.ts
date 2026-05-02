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
import { Confidence, PathStatus, RiskCategory, TestOutcome, TestStatus } from '@iseemp/core';
import { startMockSink } from './sink.js';
import {
  planSafeProfile,
  planDemoConfirmProfile,
  planGithubSafeCanaryProfile,
  assessGithubSafeCanaryRefusal,
  executePlannedTest,
  executeGithubSafeCanaryPlannedTest,
  bumpConfidence,
  bumpSeverity,
  downgradeSeverity,
  downgradeConfidence,
  type GithubSafeCanaryConfig,
  type TesterProfile,
  type PlannedTest,
} from './runner.js';
import { connectServer, callTool, type ConnectedServer } from './mcp-runtime.js';

export interface TestOptions {
  collectionId?: string;
  profile?: TesterProfile;
  profileExplicitlySelected?: boolean;
  githubSafeCanary?: GithubSafeCanaryConfig;
  dbPath?: string;
}

export interface TestSummary {
  collectionId: string;
  profile: TesterProfile;
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
  if (profile !== 'safe' && profile !== 'demo-confirm' && profile !== 'github-safe-canary') {
    throw new Error(`Unknown test profile: ${profile}`);
  }
  const refusal = assessGithubSafeCanaryRefusal(
    profile,
    options.githubSafeCanary,
    options.profileExplicitlySelected === true,
  );
  if (refusal.refused) {
    throw new Error(refusal.reasons.join(' '));
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

  const planned =
    profile === 'demo-confirm'
      ? planDemoConfirmProfile(servers, toolsByServer)
      : profile === 'github-safe-canary'
        ? planGithubSafeCanaryProfile(servers, toolsByServer)
        : planSafeProfile(servers, toolsByServer);
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
      if (!conn) {
        skipped++;
        const startedAt = new Date().toISOString();
        const testRunId = `testrun:skip:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
        allTestRuns.push({
          id: testRunId,
          collectionId: col.id,
          profile,
          testCaseId: p.caseDef.id,
          testCaseName: p.caseDef.name,
          candidatePathId: p.candidatePathId,
          serverId: p.serverId,
          sourceToolId: p.sourceTool?.id,
          sinkToolId: p.sinkTool?.id,
          pathSummary: p.caseDef.pathSummary,
          plan: p.caseDef.plan,
          toolCalls: [],
          canaryObserved: false,
          outcome: TestOutcome.TEST_SKIPPED,
          status: TestStatus.INCONCLUSIVE,
          pathStatus: PathStatus.TESTED_INCONCLUSIVE,
          timestamp: startedAt,
          startedAt,
          completedAt: startedAt,
          notes: 'Server connection failed; test skipped.',
        });
        allEvidence.push({
          id: `evidence:skip:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
          testRunId,
          candidatePathId: p.candidatePathId,
          type: 'skip',
          content: {
            reason: 'Server connection failed',
            serverId: p.serverId,
            sourceToolId: p.sourceTool?.id ?? null,
            sinkToolId: p.sinkTool?.id ?? null,
          },
          createdAt: startedAt,
        });
        continue;
      }

      const ctx = {
        collectionId: col.id,
        profile,
        invoke: async (_serverId: string, toolName: string, args: Record<string, unknown>) => {
          return callTool(conn.client, toolName, args);
        },
        sink,
      };

      const executed =
        profile === 'github-safe-canary'
          ? await executeGithubSafeCanaryPlannedTest({
              ctx,
              planned: p,
              testRunId: `testrun:ghsafe:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
              config: options.githubSafeCanary!,
            })
          : await executePlannedTest(ctx, p);
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
  applyTestResultsToFindings(col.id, allTestRuns, findingsRepo);

  const confirmed = allTestRuns.filter((r) => r.outcome === TestOutcome.TESTED_CONFIRMED).length;
  const rejected = allTestRuns.filter((r) => r.outcome === TestOutcome.TESTED_REJECTED).length;
  const inconclusive = allTestRuns.filter((r) => r.outcome === TestOutcome.TESTED_INCONCLUSIVE || r.outcome === TestOutcome.TEST_ERROR).length;

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
export function applyTestResultsToFindings(
  collectionId: string,
  testRuns: TestRun[],
  findingsRepo: ReturnType<typeof createFindingsRepo>,
): void {
  if (testRuns.length === 0) return;
  const findings = findingsRepo.findByCollection(collectionId);

  const updated: Finding[] = [];
  for (const finding of findings) {
    const matched = matchRunsToFinding(finding, testRuns);
    if (matched.length === 0) continue;
    const newFinding = applyRunsToFinding(finding, matched);
    updated.push(newFinding);
  }

  if (updated.length > 0) {
    findingsRepo.insertMany(updated.map(findingToRow));
  }
}

export function matchRunsToFinding(
  finding: Finding,
  testRuns: TestRun[],
): TestRun[] {
  if (finding.candidatePathId) {
    const deterministic = testRuns.filter(
      (run) => run.candidatePathId && run.candidatePathId === finding.candidatePathId,
    );
    if (deterministic.length > 0) return deterministic;
  }

  // Fallback fuzzy matching by category + affected nodes.
  const targetServerIds = finding.affectedNodeIds
    .filter((n) => n.startsWith('server:'))
    .map((n) => n.slice('server:'.length));
  const targetToolIds = finding.affectedNodeIds
    .filter((n) => n.startsWith('tool:'))
    .map((n) => n.slice('tool:'.length));

  const out: TestRun[] = [];
  for (const run of testRuns) {
    const serverMatches =
      targetServerIds.length === 0 || (run.serverId ? targetServerIds.includes(run.serverId) : false);
    const toolMatches =
      targetToolIds.length === 0 ||
      (run.sourceToolId ? targetToolIds.includes(run.sourceToolId) : false) ||
      (run.sinkToolId ? targetToolIds.includes(run.sinkToolId) : false);

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
      testCaseId === 'READ_SENSITIVE_MEDIUM_TO_SEND_EXTERNAL' ||
      testCaseId === 'READ_METADATA_LOW_TO_SEND_EXTERNAL' ||
      testCaseId === 'GITHUB_READ_CONTROLLED_ARTIFACT' ||
      testCaseId === 'GITHUB_EXTERNAL_SEND_LIKE_CONTROLLED_ARTIFACT')
  ) {
    return true;
  }
  if (category === RiskCategory.SENSITIVE_DATA_EXPOSURE) {
    return (
      testCaseId === 'READ_SECRET_HIGH_TO_SEND_EXTERNAL' ||
      testCaseId === 'READ_SENSITIVE_MEDIUM_TO_SEND_EXTERNAL' ||
      testCaseId === 'GITHUB_READ_CONTROLLED_ARTIFACT'
    );
  }
  if (
    category === RiskCategory.PRIVILEGED_MUTATION &&
    (testCaseId === 'MUTATE_REMOTE_STATE_EXPOSED' ||
      testCaseId === 'GITHUB_ISSUE_PR_WRITE_CONTROLLED_ARTIFACT' ||
      testCaseId === 'GITHUB_REPOSITORY_MUTATION_CONTROLLED_ARTIFACT')
  ) {
    return true;
  }
  return false;
}

function stripTestExplanation(explanation: string | undefined): string | undefined {
  if (!explanation) return explanation;
  // Remove any lines previously appended by the test runner (they start with "Test ").
  const lines = explanation.split('\n').filter((l) => !l.trimStart().startsWith('Test '));
  const trimmed = lines.join('\n').trimEnd();
  return trimmed || undefined;
}

export function applyRunsToFinding(finding: Finding, runs: TestRun[]): Finding {
  const confirmed = runs.find((r) => r.outcome === TestOutcome.TESTED_CONFIRMED);
  const rejected = runs.find((r) => r.outcome === TestOutcome.TESTED_REJECTED);
  const inconclusive = runs.find((r) => r.outcome === TestOutcome.TESTED_INCONCLUSIVE || r.outcome === TestOutcome.TEST_ERROR);
  const skipped = runs.find((r) => r.outcome === TestOutcome.TEST_SKIPPED);
  const baseExplanation = stripTestExplanation(finding.explanation);
  const next: Finding = {
    ...finding,
    testRunIds: Array.from(new Set(runs.map((r) => r.id))),
    candidatePathId: finding.candidatePathId ?? runs[0]?.candidatePathId,
  };

  if (confirmed) {
    next.tested = true;
    next.observed = true;
    next.pathStatus = PathStatus.TESTED_CONFIRMED;
    next.confidence = bumpConfidence(finding.confidence);
    next.severity = bumpSeverity(finding.severity);
    next.staticPossible = true;
    next.explanation = appendExplanation(
      baseExplanation,
      'Test confirmed this path via canary observation.',
    );
  } else if (rejected) {
    next.tested = true;
    next.observed = false;
    next.pathStatus = PathStatus.TESTED_REJECTED;
    next.confidence = Confidence.LOW;
    next.severity = downgradeSeverity(finding.severity);
    next.explanation = appendExplanation(
      baseExplanation,
      'Test execution did not reach sink; path likely not viable.',
    );
  } else if (inconclusive) {
    next.tested = true;
    next.observed = false;
    next.pathStatus = PathStatus.TESTED_INCONCLUSIVE;
    next.confidence = downgradeConfidence(finding.confidence);
    next.explanation = appendExplanation(
      baseExplanation,
      'Test inconclusive; path not proven or disproven.',
    );
  } else if (skipped) {
    next.tested = false;
    next.observed = false;
    next.explanation = appendExplanation(baseExplanation, 'Test skipped due to unavailable execution environment.');
  }

  return next;
}

function appendExplanation(prev: string | undefined, line: string): string {
  if (!prev) return line;
  return `${prev}\n${line}`;
}
