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
import { Confidence, PathStatus, RiskCategory, TestOutcome, TestStatus, ValidationMode } from '@iseemp/core';
import { startMockSink } from './sink.js';
import {
  planSafeProfile,
  planDemoConfirmProfile,
  planGithubSafeCanaryProfile,
  planPromptInjectionGithubProfile,
  planPromptInjectionFetchProfile,
  assessGithubSafeCanaryRefusal,
  executePlannedTest,
  executeGithubSafeCanaryPlannedTest,
  executePromptInjectionGithubPlannedTest,
  executePromptInjectionFetchPlannedTest,
  bumpConfidence,
  bumpSeverity,
  downgradeSeverity,
  downgradeConfidence,
  type GithubSafeCanaryConfig,
  type TesterProfile,
  type PlannedTest,
} from './runner.js';
import { connectServer, callTool, type ConnectedServer } from './mcp-runtime.js';
import { PROFILE_REGISTRY, getProfileDescriptor, type ProfileDescriptor } from './profile-descriptor.js';

// Score 3+ indicates at least one medium-strength behavioral signal from the
// deviation model (beyond sequence-only noise), so classify as possible.
const PROMPT_INJECTION_POSSIBLE_SCORE_THRESHOLD = 3;

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
  profilesPlanned: number;
  profilesRun: number;
  profilesSkipped: number;
  profilesPassed: number;
  profilesFailed: number;
  skippedReasons: string[];
  failedReasons: string[];
  confirmed: number;
  rejected: number;
  inconclusive: number;
  skipped: number;
  injectionConfirmed: number;
  trustBoundaryConfirmed: number;
  behaviouralDeviation: number;
  lethalTrifectaConfirmed: number;
  lethalTrifectaPossible: number;
  lethalTrifectaNone: number;
  testRuns: TestRun[];
}

export function summarizeRunsForCli(testRuns: TestRun[]): {
  profilesPlanned: number;
  profilesRun: number;
  profilesSkipped: number;
  profilesPassed: number;
  profilesFailed: number;
  skippedReasons: string[];
  failedReasons: string[];
  confirmed: number;
  rejected: number;
  inconclusive: number;
  skipped: number;
  injectionConfirmed: number;
  trustBoundaryConfirmed: number;
  behaviouralDeviation: number;
} {
  const profilesPlanned = testRuns.length > 0 ? 1 : 0;
  const skippedRuns = testRuns.filter((r) => r.outcome === TestOutcome.TEST_SKIPPED);
  const ranAny = testRuns.some((r) => r.outcome !== TestOutcome.TEST_SKIPPED);
  const profilesRun = ranAny ? 1 : 0;
  const profilesSkipped = profilesPlanned - profilesRun;
  const failedRuns = testRuns.filter(
    (r) => r.outcome === TestOutcome.TEST_ERROR || r.outcome === TestOutcome.TESTED_REJECTED,
  );
  const profilesFailed = profilesRun > 0 && failedRuns.length > 0 ? 1 : 0;
  const profilesPassed = profilesRun > 0 && profilesFailed === 0 ? 1 : 0;
  const confirmed = testRuns.filter(
    (r) =>
      r.pathStatus === PathStatus.TESTED_CONFIRMED ||
      r.pathStatus === PathStatus.TRUST_BOUNDARY_CONFIRMED ||
      r.pathStatus === PathStatus.TRUST_BOUNDARY_EXPLOIT_CONFIRMED,
  ).length;
  const rejected = testRuns.filter((r) => r.pathStatus === PathStatus.TESTED_REJECTED).length;
  const inconclusive = testRuns.filter((r) => r.pathStatus === PathStatus.TESTED_INCONCLUSIVE).length;
  const skipped = testRuns.filter((r) => r.outcome === TestOutcome.TEST_SKIPPED).length;
  const injectionConfirmed = testRuns.filter((r) => r.injectionConfirmed === true).length;
  const trustBoundaryConfirmed = testRuns.filter(
    (r) =>
      r.pathStatus === PathStatus.TRUST_BOUNDARY_CONFIRMED ||
      r.pathStatus === PathStatus.TRUST_BOUNDARY_EXPLOIT_CONFIRMED,
  ).length;
  const behaviouralDeviation = testRuns.filter((r) => r.deviationDetected === true).length;
  const skippedReasons = Array.from(
    new Set(skippedRuns.map((r) => r.notes).filter((n): n is string => typeof n === 'string' && n.length > 0)),
  );
  const failedReasons = Array.from(
    new Set(failedRuns.map((r) => r.notes).filter((n): n is string => typeof n === 'string' && n.length > 0)),
  );
  return {
    profilesPlanned,
    profilesRun,
    profilesSkipped,
    profilesPassed,
    profilesFailed,
    skippedReasons,
    failedReasons,
    confirmed,
    rejected,
    inconclusive,
    skipped,
    injectionConfirmed,
    trustBoundaryConfirmed,
    behaviouralDeviation,
  };
}

/**
 * Run the safe deterministic-test profile against the latest (or specified)
 * collection. This connects to each MCP server with a planned test, executes
 * the plan, persists test_runs + evidence, and updates the matching findings
 * to tested_confirmed / tested_rejected / tested_inconclusive.
 */
export async function runTests(options: TestOptions): Promise<TestSummary> {
  const profile = options.profile ?? 'safe';
  const descriptor = PROFILE_REGISTRY.get(profile);
  if (!descriptor) {
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

  const planners: Record<TesterProfile, (srv: ServerRow[], map: Map<string, ToolRow[]>) => PlannedTest[]> = {
    safe: planSafeProfile,
    'demo-confirm': planDemoConfirmProfile,
    'github-safe-canary': planGithubSafeCanaryProfile,
    'prompt-injection-github': planPromptInjectionGithubProfile,
    'prompt-injection-fetch': planPromptInjectionFetchProfile,
    'prompt-injection-db': planSafeProfile,
  };
  const planned = planners[profile](servers, toolsByServer);
  if (planned.length === 0) {
    return {
      collectionId: col.id,
      profile,
      totalPlanned: 0,
      profilesPlanned: 0,
      profilesRun: 0,
      profilesSkipped: 0,
      profilesPassed: 0,
      profilesFailed: 0,
      skippedReasons: [],
      failedReasons: [],
      confirmed: 0,
      rejected: 0,
      inconclusive: 0,
      skipped: 0,
      injectionConfirmed: 0,
      trustBoundaryConfirmed: 0,
      behaviouralDeviation: 0,
      lethalTrifectaConfirmed: 0,
      lethalTrifectaPossible: 0,
      lethalTrifectaNone: 0,
      testRuns: [],
    };
  }

  // Clear previous runs for this collection so re-runs are deterministic.
  testRunsRepo.deleteByCollection(col.id);

  const sink = await startMockSink();
  const connected = new Map<string, ConnectedServer>();
  const allTestRuns: TestRun[] = [];
  const allEvidence: Evidence[] = [];

  try {
    for (const p of planned) {
      const conn = await ensureConnection(connected, servers, p);
      if (!conn) {
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
          : profile === 'prompt-injection-github'
            ? await executePromptInjectionGithubPlannedTest({
                ctx,
                planned: p,
                testRunId: `testrun:promptinj:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
                config: options.githubSafeCanary!,
              })
          : profile === 'prompt-injection-fetch'
            ? await executePromptInjectionFetchPlannedTest(
                ctx,
                p,
                `testrun:promptinjfetch:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
              )
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
  applyTestResultsToFindings(col.id, allTestRuns, findingsRepo, descriptor);

  const {
    profilesPlanned,
    profilesRun,
    profilesSkipped,
    profilesPassed,
    profilesFailed,
    skippedReasons,
    failedReasons,
    confirmed,
    rejected,
    inconclusive,
    skipped,
    injectionConfirmed,
    trustBoundaryConfirmed,
    behaviouralDeviation,
  } = summarizeRunsForCli(allTestRuns);
  const lethalCounts = summarizeLethalTrifecta(findingsRepo.findByCollection(col.id));

  return {
    collectionId: col.id,
    profile,
    totalPlanned: planned.length,
    profilesPlanned,
    profilesRun,
    profilesSkipped,
    profilesPassed,
    profilesFailed,
    skippedReasons,
    failedReasons,
    confirmed,
    rejected,
    inconclusive,
    skipped,
    injectionConfirmed,
    trustBoundaryConfirmed,
    behaviouralDeviation,
    lethalTrifectaConfirmed: lethalCounts.confirmed,
    lethalTrifectaPossible: lethalCounts.possible,
    lethalTrifectaNone: lethalCounts.none,
    testRuns: allTestRuns,
  };
}

function summarizeLethalTrifecta(findings: Finding[]): {
  confirmed: number;
  possible: number;
  none: number;
} {
  let confirmed = 0;
  let possible = 0;
  let none = 0;
  for (const finding of findings) {
    if (finding.lethalTrifectaStatus === 'CONFIRMED') {
      confirmed += 1;
    } else if (finding.lethalTrifectaStatus === 'POSSIBLE') {
      possible += 1;
    } else {
      none += 1;
    }
  }
  return { confirmed, possible, none };
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
  profileDescriptor: ProfileDescriptor,
): void {
  if (testRuns.length === 0) return;
  const findings = findingsRepo.findByCollection(collectionId);

  const updated: Finding[] = [];
  for (const finding of findings) {
    const matched = matchRunsToFinding(finding, testRuns);
    if (matched.length === 0) continue;
    const newFinding = applyRunsToFinding(finding, matched, profileDescriptor);
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
  if (
    category === RiskCategory.PROMPT_INJECTION &&
    (testCaseId === 'PROMPT_INJECTION_GITHUB_ISSUE_TO_SINK' ||
      testCaseId === 'PROMPT_INJECTION_FETCH_TO_SINK')
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

export function applyRunsToFinding(
  finding: Finding,
  runs: TestRun[],
  profileDescriptor?: ProfileDescriptor,
): Finding {
  const confirmed = runs.find((r) => r.outcome === TestOutcome.TESTED_CONFIRMED);
  const rejected = runs.find((r) => r.outcome === TestOutcome.TESTED_REJECTED);
  const inconclusive = runs.find((r) => r.outcome === TestOutcome.TESTED_INCONCLUSIVE || r.outcome === TestOutcome.TEST_ERROR);
  const skipped = runs.find((r) => r.outcome === TestOutcome.TEST_SKIPPED);
  const baseExplanation = stripTestExplanation(finding.explanation);
  const next: Finding = {
    ...finding,
    testRunIds: Array.from(new Set(runs.map((r) => r.id))),
    candidatePathId: finding.candidatePathId ?? runs[0]?.candidatePathId,
    baselinePlan:
      runs.find((r) => (r.baselineToolCalls?.length ?? 0) > 0)?.baselineToolCalls ?? finding.baselinePlan,
    trustBoundaryExploitConfirmed: runs.some((r) => r.trustBoundaryExploitConfirmed === true),
  };
  const resolvedDescriptor =
    profileDescriptor ??
    (runs[0]?.profile ? getProfileDescriptor(runs[0].profile) : undefined);
  const validationMode = resolvedDescriptor?.validationMode;
  const allowsCoercionConfirmation =
    validationMode === ValidationMode.COERCION_CANARY ||
    validationMode === ValidationMode.COMPOSITE;
  const allowsTrustBoundaryConfirmation =
    validationMode === ValidationMode.TRUST_BOUNDARY ||
    validationMode === ValidationMode.COMPOSITE;

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
    if (allowsCoercionConfirmation && (
      finding.category === RiskCategory.PROMPT_INJECTION ||
      finding.lethalTrifectaStatus === 'POSSIBLE'
    )) {
      next.lethalTrifectaStatus = 'CONFIRMED';
      next.injectionConfirmed = true;
      next.subCategory = 'PROMPT_INJECTION_CONFIRMED';
      const hasExploitChain = runs.some((run) => {
        const chain = run.injectionChain ?? [];
        const servers = new Set(
          chain
            .filter((step) => step.markerPresent && typeof step.serverId === 'string' && step.serverId.length > 0)
            .map((step) => step.serverId!),
        );
        return servers.size >= 2;
      });
      if (hasExploitChain) {
        next.subCategory = 'PROMPT_INJECTION_EXPLOIT_CHAIN';
        next.injectionExploitChain = true;
      }
      if (next.trustBoundaryExploitConfirmed) {
        next.pathStatus = PathStatus.TRUST_BOUNDARY_EXPLOIT_CONFIRMED;
        next.trustBoundaryConfirmed = true;
        next.subCategory = 'TRUST_BOUNDARY_EXPLOIT_CONFIRMED';
      } else if (finding.crossesTrustBoundary && allowsTrustBoundaryConfirmation) {
        next.pathStatus = PathStatus.TRUST_BOUNDARY_CONFIRMED;
        next.trustBoundaryConfirmed = true;
      }
    } else {
      next.injectionConfirmed = false;
      if (finding.crossesTrustBoundary && allowsTrustBoundaryConfirmation) {
        next.pathStatus = PathStatus.TRUST_BOUNDARY_CONFIRMED;
        next.trustBoundaryConfirmed = true;
      }
    }
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
    if (
      finding.lethalTrifectaStatus === 'POSSIBLE'
    ) {
      next.lethalTrifectaStatus = 'POSSIBLE';
    }
    const hasDeviation = runs.some((r) => r.deviationDetected === true);
    const maxDeviationScore = runs.reduce(
      (max, run) => Math.max(max, run.deviationScore ?? 0),
      0,
    );
    if (allowsCoercionConfirmation && hasDeviation && finding.category === RiskCategory.PROMPT_INJECTION) {
      if (maxDeviationScore >= PROMPT_INJECTION_POSSIBLE_SCORE_THRESHOLD) {
        next.subCategory = 'PROMPT_INJECTION_POSSIBLE';
      }
      next.injectionConfirmed = false;
    }
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

export * from './profile-descriptor.js';
export * from './profile-assertions.js';
