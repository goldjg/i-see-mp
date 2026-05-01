import { Capability, PathStatus, TestStatus, TestOutcome, RiskCategory } from '@iseemp/core';
import type { ToolCall, TestRun, Evidence, Confidence } from '@iseemp/core';
import type { ServerRow, ToolRow } from '@iseemp/storage';
import type { ToolCallResult } from './mcp-runtime.js';
import type { MockSink } from './sink.js';
import { redactRecord, redactValue } from './redact.js';

/**
 * Abstract over the MCP runtime so tests can run the planner against a fake
 * invoker without spawning a real MCP server.
 */
export interface ToolInvoker {
  /** Call a tool by name on the given server (server is pre-resolved by the runner). */
  call(toolName: string, args: Record<string, unknown>): Promise<ToolCallResult>;
}

export type TestCaseId =
  | 'READ_SECRET_HIGH_TO_SEND_EXTERNAL'
  | 'READ_SENSITIVE_MEDIUM_TO_SEND_EXTERNAL'
  | 'READ_METADATA_LOW_TO_SEND_EXTERNAL'
  | 'MUTATE_REMOTE_STATE_EXPOSED'
  | 'GITHUB_READ_CONTROLLED_ARTIFACT'
  | 'GITHUB_ISSUE_PR_WRITE_CONTROLLED_ARTIFACT'
  | 'GITHUB_REPOSITORY_MUTATION_CONTROLLED_ARTIFACT'
  | 'GITHUB_EXTERNAL_SEND_LIKE_CONTROLLED_ARTIFACT';

export type TesterProfile = 'safe' | 'demo-confirm' | 'github-safe-canary';

export interface GithubSafeCanaryConfig {
  owner?: string;
  repo?: string;
  branchPrefix?: string;
  issuePrefix?: string;
  canaryPrefix?: string;
  allowUnsafeTestRepo?: boolean;
  keepArtifacts?: boolean;
  createPullRequest?: boolean;
}

export interface GithubSafeCanaryRefusal {
  refused: boolean;
  reasons: string[];
}

export interface TestCaseDefinition {
  id: TestCaseId;
  name: string;
  category: RiskCategory;
  pathSummary: string;
  /** Capabilities the source tool must have. */
  sourceCaps: Capability[];
  /** Capabilities the sink tool must have (empty for non-chain tests). */
  sinkCaps: Capability[];
  /** True if this test case targets a single tool (no chain). */
  singleTool: boolean;
  /** Plan description, persisted as evidence. */
  plan: string;
  /** Optional exact tool names for deterministic fixture matching. */
  preferredSourceToolName?: string;
  preferredSinkToolName?: string;
}

const HIGH_SECRET_CAPS: Capability[] = [
  Capability.READ_CREDENTIAL_HIGH,
  Capability.READ_SECRET_HIGH,
  Capability.READ_SECRET,
];

const EXTERNAL_SINK_CAPS: Capability[] = [
  Capability.SEND_EXTERNAL,
  Capability.SEND_HTTP,
  Capability.SEND_EMAIL,
];

const MUTATE_REMOTE_CAPS: Capability[] = [
  Capability.MUTATE_REMOTE_STATE,
  Capability.MUTATE_REPOSITORY,
  Capability.MUTATE_ISSUE_OR_PR,
];

const SAFE_REPO_NAME_RE =
  /^(?:(?:canary|sandbox|disposable|test|safe)(?:[-_].+)?)$|^(?:.+[-_](?:canary|sandbox|disposable|test|safe))$/i;
const PROVEN_BLOCKED_OR_IMPOSSIBLE_RE =
  /^(?:error|failed|forbidden|denied|unauthorized|unprocessable|validation|resource not accessible|not found|unsupported|cannot\b).*(?:forbidden|denied|unauthorized|requires .* permission|not found|unsupported|policy|validation|cannot|resource not accessible)/i;
const BRANCH_NOT_FOUND_RE = /resource not found:\s*branch\s.+not found|branch\s.+not found/i;
const ISSUE_PR_TOOL_NAME_RE = /issue|pull_request|comment|review/;
const READ_TOOL_NAME_RE = /^(get|list|read|search)_/;
const TOOL_CAPS_CACHE = new Map<string, Capability[]>();

export const SAFE_PROFILE_CASES: TestCaseDefinition[] = [
  {
    id: 'READ_SECRET_HIGH_TO_SEND_EXTERNAL',
    name: 'Secret read → external send',
    category: RiskCategory.DATA_EXFILTRATION,
    pathSummary: 'READ_SECRET_HIGH -> MODEL_CONTEXT -> SEND_EXTERNAL',
    sourceCaps: HIGH_SECRET_CAPS,
    sinkCaps: EXTERNAL_SINK_CAPS,
    singleTool: false,
    plan: [
      'Step 1: invoke a credential/secret read tool to get a deterministic fake secret value.',
      'Step 2: invoke an external-send tool with the secret embedded in the payload, targeting the local mock sink.',
      'Step 3: observe whether the local mock sink received the canary value (path tested_confirmed) or treat as tested_inconclusive when sink reachability is unclear.',
    ].join('\n'),
  },
  {
    id: 'READ_SENSITIVE_MEDIUM_TO_SEND_EXTERNAL',
    name: 'Sensitive metadata → external send',
    category: RiskCategory.DATA_EXFILTRATION,
    pathSummary: 'READ_SENSITIVE_MEDIUM -> MODEL_CONTEXT -> SEND_EXTERNAL',
    sourceCaps: [Capability.READ_SENSITIVE_MEDIUM],
    sinkCaps: EXTERNAL_SINK_CAPS,
    singleTool: false,
    plan: [
      'Step 1: invoke a sensitive-metadata read tool to fetch fake org/team data containing a canary marker.',
      'Step 2: invoke an external-send tool with that data, targeting the local mock sink.',
      'Step 3: observe whether the canary marker appeared in the sink (tested_confirmed) or mark tested_inconclusive when no marker is observed.',
    ].join('\n'),
  },
  {
    id: 'MUTATE_REMOTE_STATE_EXPOSED',
    name: 'Remote-state mutation tool exposed',
    category: RiskCategory.PRIVILEGED_MUTATION,
    pathSummary: 'AGENT -> MUTATE_REMOTE_STATE',
    sourceCaps: MUTATE_REMOTE_CAPS,
    sinkCaps: [],
    singleTool: true,
    plan: [
      'Step 1: invoke a remote-state mutation tool with a fake resource and a deterministic action.',
      'Step 2: confirm the call was accepted by the server (the fixture acknowledges, no real mutation occurs).',
      'Step 3: record tested_confirmed if the call succeeded, tested_rejected if it errored.',
    ].join('\n'),
  },
];

export const DEMO_CONFIRM_PROFILE_CASES: TestCaseDefinition[] = [
  {
    id: 'READ_SECRET_HIGH_TO_SEND_EXTERNAL',
    name: 'Demo: secret canary → mock sink',
    category: RiskCategory.DATA_EXFILTRATION,
    pathSummary: 'READ_SECRET_HIGH -> MODEL_CONTEXT -> SEND_EXTERNAL',
    sourceCaps: HIGH_SECRET_CAPS,
    sinkCaps: EXTERNAL_SINK_CAPS,
    singleTool: false,
    preferredSourceToolName: 'read_secret_canary',
    preferredSinkToolName: 'send_to_mock_sink',
    plan: [
      'Step 1: invoke read_secret_canary to return a deterministic canary secret.',
      'Step 2: invoke send_to_mock_sink with the secret payload to local mock sink.',
      'Step 3: confirm canary is observed in the local sink (tested_confirmed).',
    ].join('\n'),
  },
  {
    id: 'READ_METADATA_LOW_TO_SEND_EXTERNAL',
    name: 'Demo: low metadata → blocked sink',
    category: RiskCategory.DATA_EXFILTRATION,
    pathSummary: 'READ_METADATA_LOW -> MODEL_CONTEXT -> SEND_EXTERNAL',
    sourceCaps: [Capability.READ_METADATA_LOW],
    sinkCaps: EXTERNAL_SINK_CAPS,
    singleTool: false,
    preferredSourceToolName: 'read_metadata',
    preferredSinkToolName: 'blocked_send',
    plan: [
      'Step 1: invoke read_metadata to fetch deterministic low-sensitivity metadata.',
      'Step 2: invoke blocked_send with the payload.',
      'Step 3: blocked_send rejects the call (tested_rejected).',
    ].join('\n'),
  },
  {
    id: 'MUTATE_REMOTE_STATE_EXPOSED',
    name: 'Demo: dry-run remote mutation',
    category: RiskCategory.PRIVILEGED_MUTATION,
    pathSummary: 'AGENT -> MUTATE_REMOTE_STATE',
    sourceCaps: MUTATE_REMOTE_CAPS,
    sinkCaps: [],
    singleTool: true,
    preferredSourceToolName: 'mutate_remote_state',
    plan: [
      'Step 1: invoke mutate_remote_state in dry-run mode.',
      'Step 2: the fixture acknowledges dry-run without making a real change.',
      'Step 3: record tested_inconclusive because dry-run does not prove mutation impact.',
    ].join('\n'),
  },
];

export const GITHUB_SAFE_CANARY_PROFILE_CASES: TestCaseDefinition[] = [
  {
    id: 'GITHUB_READ_CONTROLLED_ARTIFACT',
    name: 'GitHub controlled canary read/search',
    category: RiskCategory.DATA_EXFILTRATION,
    pathSummary: 'READ_REMOTE_DATA -> CONTROLLED_GITHUB_ARTIFACT',
    sourceCaps: [Capability.READ_REMOTE_DATA, Capability.QUERY_REMOTE_SYSTEM, Capability.READ_METADATA_LOW],
    sinkCaps: [],
    singleTool: true,
    plan: [
      'Step 1: create/reuse controlled canary artifacts in a disposable GitHub test repository.',
      'Step 2: invoke discovered GitHub read/search tooling against controlled artifacts.',
      'Step 3: confirm only when testRunId canary marker is observed in returned controlled artifact content.',
    ].join('\n'),
  },
  {
    id: 'GITHUB_ISSUE_PR_WRITE_CONTROLLED_ARTIFACT',
    name: 'GitHub issue/comment/PR write controls',
    category: RiskCategory.PRIVILEGED_MUTATION,
    pathSummary: 'MUTATE_ISSUE_OR_PR -> CONTROLLED_GITHUB_ARTIFACT',
    sourceCaps: [Capability.MUTATE_ISSUE_OR_PR],
    sinkCaps: [],
    singleTool: true,
    plan: [
      'Step 1: create/reuse controlled canary issue/PR artifacts with unique testRunId markers.',
      'Step 2: invoke discovered issue/comment/PR write tooling only against controlled targets.',
      'Step 3: confirm only when marker is observed in the created/updated controlled artifact response.',
    ].join('\n'),
  },
  {
    id: 'GITHUB_REPOSITORY_MUTATION_CONTROLLED_ARTIFACT',
    name: 'GitHub repository mutation controls',
    category: RiskCategory.PRIVILEGED_MUTATION,
    pathSummary: 'MUTATE_REPOSITORY -> CONTROLLED_GITHUB_ARTIFACT',
    sourceCaps: [Capability.MUTATE_REPOSITORY, Capability.MUTATE_REMOTE_STATE],
    sinkCaps: [],
    singleTool: true,
    plan: [
      'Step 1: create/update a controlled canary file and optional test branch in disposable repository.',
      'Step 2: verify canary marker through discovered read/search tool when available.',
      'Step 3: mark confirmed only when marker is observed in controlled repo artifact.',
    ].join('\n'),
  },
  {
    id: 'GITHUB_EXTERNAL_SEND_LIKE_CONTROLLED_ARTIFACT',
    name: 'GitHub external-send-like controls',
    category: RiskCategory.DATA_EXFILTRATION,
    pathSummary: 'SEND_EXTERNAL -> CONTROLLED_GITHUB_ARTIFACT',
    sourceCaps: [Capability.SEND_EXTERNAL, Capability.SEND_HTTP, Capability.SEND_EMAIL],
    sinkCaps: [],
    singleTool: true,
    plan: [
      'Step 1: invoke discovered external-send-like GitHub tooling only with controlled canary payload.',
      'Step 2: verify marker presence in expected controlled sink when one exists.',
      'Step 3: otherwise mark skipped when no observable controlled sink exists.',
    ].join('\n'),
  },
];

export interface TestPlanInput {
  serverId: string;
  serverName: string;
  tools: ToolRow[];
}

export interface PlannedTest {
  caseDef: TestCaseDefinition;
  serverId: string;
  serverName: string;
  sourceTool?: ToolRow;
  sinkTool?: ToolRow;
  candidatePathId: string;
}

export function makeCandidatePathId(parts: {
  category: string;
  sourceToolId?: string;
  sinkToolId?: string;
  serverId: string;
  pathSummary: string;
}): string {
  const cleanedPath = parts.pathSummary.replace(/\s+/g, ' ').trim();
  return [
    parts.category,
    parts.sourceToolId ?? 'none',
    parts.sinkToolId ?? 'none',
    parts.serverId,
    cleanedPath,
  ].join('|');
}

function toolHasAny(tool: ToolRow, caps: Capability[]): boolean {
  let toolCaps: string[] = [];
  try {
    toolCaps = JSON.parse(tool.capabilities) as string[];
  } catch {
    toolCaps = [];
  }
  return caps.some((c) => toolCaps.includes(c));
}

/**
 * Plan which test cases apply to which (server, tool) pairs in the collection.
 * Only servers that look like the canary fixture (or otherwise expose the
 * required source/sink tools) will produce a planned test.
 */
export function planSafeProfile(
  servers: ServerRow[],
  toolsByServer: Map<string, ToolRow[]>,
): PlannedTest[] {
  return planProfileCases(SAFE_PROFILE_CASES, servers, toolsByServer);
}

export function planDemoConfirmProfile(
  servers: ServerRow[],
  toolsByServer: Map<string, ToolRow[]>,
): PlannedTest[] {
  return planProfileCases(DEMO_CONFIRM_PROFILE_CASES, servers, toolsByServer);
}

export function getGithubSafeRepoPattern(): RegExp {
  return SAFE_REPO_NAME_RE;
}

function isGithubLikeServer(server: ServerRow, tools: ToolRow[]): boolean {
  const serverText = [
    server.name,
    server.url ?? '',
    server.command ?? '',
    server.args ?? '',
  ]
    .join(' ')
    .toLowerCase();
  if (serverText.includes('github')) return true;
  return tools.some((t) => t.name.toLowerCase().includes('github'));
}

export function assessGithubSafeCanaryRefusal(
  profile: TesterProfile,
  config: GithubSafeCanaryConfig | undefined,
  profileExplicitlySelected: boolean,
): GithubSafeCanaryRefusal {
  if (profile !== 'github-safe-canary') return { refused: false, reasons: [] };
  const reasons: string[] = [];
  const hasText = (v: string | undefined): boolean => typeof v === 'string' && v.trim().length > 0;
  if (!profileExplicitlySelected) {
    reasons.push('github-safe-canary requires explicit --profile selection.');
  }
  if (!config) {
    reasons.push('Missing required github-safe-canary test repository configuration.');
  } else {
    if (!hasText(config.owner)) reasons.push('Missing github-safe-canary.owner.');
    if (!hasText(config.repo)) reasons.push('Missing github-safe-canary.repo.');
    if (!hasText(config.branchPrefix)) reasons.push('Missing github-safe-canary.branchPrefix.');
    if (!hasText(config.issuePrefix)) reasons.push('Missing github-safe-canary.issuePrefix.');
    if (!hasText(config.canaryPrefix)) reasons.push('Missing github-safe-canary.canaryPrefix.');
    if (hasText(config.repo) && !config.allowUnsafeTestRepo && !getGithubSafeRepoPattern().test(config.repo!)) {
      reasons.push(
        'Refusing github-safe-canary run: repo name must match safe disposable pattern unless allowUnsafeTestRepo is set.',
      );
    }
  }
  return { refused: reasons.length > 0, reasons };
}

function parseCapabilities(tool: ToolRow): Capability[] {
  const cached = TOOL_CAPS_CACHE.get(tool.id);
  if (cached) return cached;
  let parsed: Capability[];
  try {
    parsed = (JSON.parse(tool.capabilities) as string[]).filter(Boolean) as Capability[];
  } catch {
    parsed = [];
  }
  TOOL_CAPS_CACHE.set(tool.id, parsed);
  return parsed;
}

function hasAnyCapability(tool: ToolRow, caps: Capability[]): boolean {
  const toolCaps = parseCapabilities(tool);
  return caps.some((c) => toolCaps.includes(c));
}

function nameMatches(tool: ToolRow, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(tool.name.toLowerCase()));
}

function isGithubReadTool(tool: ToolRow): boolean {
  return (
    hasAnyCapability(tool, [Capability.READ_REMOTE_DATA, Capability.QUERY_REMOTE_SYSTEM, Capability.READ_METADATA_LOW]) &&
    nameMatches(tool, [/^(get|list|read|search)_/, /file/, /issue/, /pull_request/, /repository/])
  );
}

function isGithubIssuePrWriteTool(tool: ToolRow): boolean {
  return (
    hasAnyCapability(tool, [Capability.MUTATE_ISSUE_OR_PR, Capability.MUTATE_REMOTE_STATE]) &&
    nameMatches(tool, [/issue/, /pull_request|pr/, /comment/, /review/, /^create_/, /^update_/])
  );
}

function isGithubRepositoryMutationTool(tool: ToolRow): boolean {
  return (
    hasAnyCapability(tool, [Capability.MUTATE_REPOSITORY, Capability.MUTATE_REMOTE_STATE]) &&
    nameMatches(tool, [/file/, /branch/, /repository|repo/, /^create_/, /^update_/, /^delete_/])
  );
}

function isGithubExternalSendLikeTool(tool: ToolRow): boolean {
  return (
    hasAnyCapability(tool, [Capability.SEND_EXTERNAL, Capability.SEND_HTTP, Capability.SEND_EMAIL]) &&
    nameMatches(tool, [/webhook/, /dispatch/, /request/, /send/])
  );
}

export function planGithubSafeCanaryProfile(
  servers: ServerRow[],
  toolsByServer: Map<string, ToolRow[]>,
): PlannedTest[] {
  // Assumption: GitHub MCP tools generally follow name patterns (get/list/search/create/update + issue/pr/file/repo).
  // This profile intentionally plans only when such discovered tool names are present.
  const planned: PlannedTest[] = [];
  for (const server of servers) {
    const tools = toolsByServer.get(server.id) ?? [];
    if (!isGithubLikeServer(server, tools)) continue;

    const readTool = tools.find(isGithubReadTool);
    if (readTool) {
      const caseDef = GITHUB_SAFE_CANARY_PROFILE_CASES[0]!;
      planned.push({
        caseDef,
        serverId: server.id,
        serverName: server.name,
        sourceTool: readTool,
        candidatePathId: makeCandidatePathId({
          category: caseDef.category,
          sourceToolId: readTool.id,
          serverId: server.id,
          pathSummary: caseDef.pathSummary,
        }),
      });
    }

    const issuePrWriteTool = tools.find(isGithubIssuePrWriteTool);
    if (issuePrWriteTool) {
      const caseDef = GITHUB_SAFE_CANARY_PROFILE_CASES[1]!;
      planned.push({
        caseDef,
        serverId: server.id,
        serverName: server.name,
        sourceTool: issuePrWriteTool,
        candidatePathId: makeCandidatePathId({
          category: caseDef.category,
          sourceToolId: issuePrWriteTool.id,
          serverId: server.id,
          pathSummary: caseDef.pathSummary,
        }),
      });
    }

    const repoMutationTool = tools.find(isGithubRepositoryMutationTool);
    if (repoMutationTool) {
      const caseDef = GITHUB_SAFE_CANARY_PROFILE_CASES[2]!;
      planned.push({
        caseDef,
        serverId: server.id,
        serverName: server.name,
        sourceTool: repoMutationTool,
        candidatePathId: makeCandidatePathId({
          category: caseDef.category,
          sourceToolId: repoMutationTool.id,
          serverId: server.id,
          pathSummary: caseDef.pathSummary,
        }),
      });
    }

    const externalSendTool = tools.find(isGithubExternalSendLikeTool);
    if (externalSendTool) {
      const caseDef = GITHUB_SAFE_CANARY_PROFILE_CASES[3]!;
      planned.push({
        caseDef,
        serverId: server.id,
        serverName: server.name,
        sourceTool: externalSendTool,
        candidatePathId: makeCandidatePathId({
          category: caseDef.category,
          sourceToolId: externalSendTool.id,
          serverId: server.id,
          pathSummary: caseDef.pathSummary,
        }),
      });
    }
  }
  return planned;
}

function planProfileCases(
  cases: TestCaseDefinition[],
  servers: ServerRow[],
  toolsByServer: Map<string, ToolRow[]>,
): PlannedTest[] {
  const planned: PlannedTest[] = [];

  for (const server of servers) {
    const tools = toolsByServer.get(server.id) ?? [];
    for (const caseDef of cases) {
      const sourceTool =
        (caseDef.preferredSourceToolName
          ? tools.find(
              (t) =>
                t.name === caseDef.preferredSourceToolName && toolHasAny(t, caseDef.sourceCaps),
            )
          : undefined) ?? tools.find((t) => toolHasAny(t, caseDef.sourceCaps));
      if (!sourceTool) continue;
      if (caseDef.singleTool) {
        planned.push({
          caseDef,
          serverId: server.id,
          serverName: server.name,
          sourceTool,
          candidatePathId: makeCandidatePathId({
            category: caseDef.category,
            sourceToolId: sourceTool.id,
            serverId: server.id,
            pathSummary: caseDef.pathSummary,
          }),
        });
        continue;
      }
      const sinkTool =
        (caseDef.preferredSinkToolName
          ? tools.find(
              (t) => t.name === caseDef.preferredSinkToolName && toolHasAny(t, caseDef.sinkCaps),
            )
          : undefined) ?? tools.find((t) => toolHasAny(t, caseDef.sinkCaps));
      if (!sinkTool) continue;
      planned.push({
        caseDef,
        serverId: server.id,
        serverName: server.name,
        sourceTool,
        sinkTool,
        candidatePathId: makeCandidatePathId({
          category: caseDef.category,
          sourceToolId: sourceTool.id,
          sinkToolId: sinkTool.id,
          serverId: server.id,
          pathSummary: caseDef.pathSummary,
        }),
      });
    }
  }

  return planned;
}

interface PlanArgs {
  sourceTool?: ToolRow;
  sinkTool?: ToolRow;
  sinkUrl?: string;
}

/**
 * Build deterministic input arguments for the source and sink calls. The shape
 * is conservative — we use generic field names that match the canary fixture
 * exactly, and fall back to harmless defaults for any other server that
 * happens to expose tools with the same capability shape.
 */
function buildSourceArgs(_args: PlanArgs): Record<string, unknown> {
  return { name: 'CANARY_SECRET_NAME', team: 'canary-team' };
}

function buildSinkArgs(payload: string, sinkUrl: string): Record<string, unknown> {
  return { url: sinkUrl, payload };
}

function buildMutateArgs(): Record<string, unknown> {
  return {
    resource: 'CANARY_RESOURCE',
    action: 'update',
    payload: JSON.stringify({ canary: 'CANARY-MUTATION-PROBE' }),
  };
}

export interface ExecutedTest {
  testRun: TestRun;
  evidence: Evidence[];
}

export interface TestRunnerContext {
  collectionId: string;
  profile: TesterProfile;
  invoke(serverId: string, toolName: string, args: Record<string, unknown>): Promise<ToolCallResult>;
  sink: MockSink;
}

function newId(prefix: string): string {
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Execute one planned test case end-to-end and return a structured TestRun
 * plus its evidence records. Inputs and outputs are redacted before being
 * persisted as evidence.
 */
export async function executePlannedTest(
  ctx: TestRunnerContext,
  planned: PlannedTest,
): Promise<ExecutedTest> {
  const startedAt = new Date().toISOString();
  const testRunId = newId('testrun');
  const toolCalls: ToolCall[] = [];
  const evidence: Evidence[] = [];

  let canaryObserved = false;
  let canaryExpected: string | undefined;
  let status: TestStatus = TestStatus.RUNNING;
  let outcome: TestOutcome = TestOutcome.TESTED_INCONCLUSIVE;
  let pathStatus: PathStatus = PathStatus.STATIC_POSSIBLE;
  let notes: string | undefined;

  function recordEvidence(
    type: string,
    content: Record<string, unknown>,
    extra: {
      stepIndex?: number;
      toolName?: string;
      redactedInput?: Record<string, unknown>;
      redactedOutput?: unknown;
    } = {},
  ): void {
    const timestamp = new Date().toISOString();
    evidence.push({
      id: newId('evidence'),
      testRunId,
      candidatePathId: planned.candidatePathId,
      type,
      stepIndex: extra.stepIndex,
      toolName: extra.toolName,
      redactedInput: extra.redactedInput,
      redactedOutput: extra.redactedOutput,
      content: {
        ...content,
        candidatePathId: planned.candidatePathId,
        sourceTool: planned.sourceTool?.name ?? null,
        sinkTool: planned.sinkTool?.name ?? null,
        timestamp,
      },
      createdAt: timestamp,
    });
  }

  recordEvidence('plan', {
    testCaseId: planned.caseDef.id,
    pathSummary: planned.caseDef.pathSummary,
    plan: planned.caseDef.plan,
    serverId: planned.serverId,
    serverName: planned.serverName,
    sourceTool: planned.sourceTool?.name,
    sinkTool: planned.sinkTool?.name,
    sinkUrl: ctx.sink.url,
  });

  try {
    if (planned.caseDef.singleTool) {
      // MUTATE_REMOTE_STATE_EXPOSED: just verify the mutation tool can be invoked.
      if (!planned.sourceTool) throw new Error('Planned test missing source tool');
      const args = buildMutateArgs();
      const t0 = Date.now();
      const result = await ctx.invoke(planned.serverId, planned.sourceTool.name, args);
      const durationMs = Date.now() - t0;
      toolCalls.push({
        step: 1,
        toolId: planned.sourceTool.id,
        toolName: planned.sourceTool.name,
        serverId: planned.serverId,
        input: redactRecord(args),
        output: redactValue({ text: result.text, isError: result.isError }),
        durationMs,
        ...(result.isError ? { error: result.text } : {}),
      });
      recordEvidence('tool_call', {
        step: 1,
        tool: planned.sourceTool.name,
        input: redactRecord(args),
        output: redactValue({ text: result.text, isError: result.isError }),
        durationMs,
      }, {
        stepIndex: 1,
        toolName: planned.sourceTool.name,
        redactedInput: redactRecord(args),
        redactedOutput: redactValue({ text: result.text, isError: result.isError }),
      });
      if (result.isError) {
        outcome = TestOutcome.TESTED_REJECTED;
        status = TestStatus.REJECTED;
        pathStatus = PathStatus.TESTED_REJECTED;
        notes = `Mutation tool errored: ${result.text}`;
      } else if (ctx.profile === 'demo-confirm' && /"dryRun"\s*:\s*true/.test(result.text)) {
        outcome = TestOutcome.TESTED_INCONCLUSIVE;
        status = TestStatus.INCONCLUSIVE;
        pathStatus = PathStatus.TESTED_INCONCLUSIVE;
        canaryObserved = false;
        canaryExpected = 'dry-run mutation acknowledged';
        notes = 'Mutation tool ran in dry-run mode; no real state change confirmed.';
      } else {
        outcome = TestOutcome.TESTED_CONFIRMED;
        status = TestStatus.CONFIRMED;
        pathStatus = PathStatus.TESTED_CONFIRMED;
        canaryObserved = true; // The "canary" here is "the mutation call was accepted".
        canaryExpected = 'tool accepted mutation request';
      }
    } else {
      // Two-step canary path: read source -> send via sink -> observe in mock sink.
      if (!planned.sourceTool || !planned.sinkTool) {
        throw new Error('Planned test missing source or sink tool');
      }
      const sourceArgs = buildSourceArgs({});
      const t0 = Date.now();
      const sourceResult = await ctx.invoke(
        planned.serverId,
        planned.sourceTool.name,
        sourceArgs,
      );
      toolCalls.push({
        step: 1,
        toolId: planned.sourceTool.id,
        toolName: planned.sourceTool.name,
        serverId: planned.serverId,
        input: redactRecord(sourceArgs),
        output: redactValue({ text: sourceResult.text, isError: sourceResult.isError }),
        durationMs: Date.now() - t0,
        ...(sourceResult.isError ? { error: sourceResult.text } : {}),
      });
      recordEvidence('tool_call', {
        step: 1,
        tool: planned.sourceTool.name,
        input: redactRecord(sourceArgs),
        output: redactValue({ text: sourceResult.text, isError: sourceResult.isError }),
      }, {
        stepIndex: 1,
        toolName: planned.sourceTool.name,
        redactedInput: redactRecord(sourceArgs),
        redactedOutput: redactValue({ text: sourceResult.text, isError: sourceResult.isError }),
      });

      if (sourceResult.isError) {
        outcome = TestOutcome.TESTED_REJECTED;
        status = TestStatus.REJECTED;
        pathStatus = PathStatus.TESTED_REJECTED;
        notes = `Source tool errored: ${sourceResult.text}`;
      } else {
        // Embed the *raw* output (not redacted) into the sink payload so the
        // mock sink can observe the canary marker, then redact for evidence.
        const canaryMarker = pickCanaryMarker(sourceResult.text);
        if (canaryMarker === null) {
          // Source tool returned no CANARY- token — real/unexpected data.
          // Using a substring as a marker risks a false negative, so treat as inconclusive.
          status = TestStatus.INCONCLUSIVE;
          outcome = TestOutcome.TESTED_INCONCLUSIVE;
          pathStatus = PathStatus.TESTED_INCONCLUSIVE;
          notes = 'Source tool response contained no CANARY- token; cannot reliably detect exfiltration. The tool may not support the canary fixture pattern.';
        } else {
          canaryExpected = canaryMarker;
          const sinkArgs = buildSinkArgs(sourceResult.text, ctx.sink.url);
          const t1 = Date.now();
          const sinkResult = await ctx.invoke(planned.serverId, planned.sinkTool.name, sinkArgs);
          toolCalls.push({
            step: 2,
            toolId: planned.sinkTool.id,
            toolName: planned.sinkTool.name,
            serverId: planned.serverId,
            input: redactRecord(sinkArgs),
            output: redactValue({ text: sinkResult.text, isError: sinkResult.isError }),
            durationMs: Date.now() - t1,
            ...(sinkResult.isError ? { error: sinkResult.text } : {}),
          });
          recordEvidence('tool_call', {
            step: 2,
            tool: planned.sinkTool.name,
            input: redactRecord(sinkArgs),
            output: redactValue({ text: sinkResult.text, isError: sinkResult.isError }),
          }, {
            stepIndex: 2,
            toolName: planned.sinkTool.name,
            redactedInput: redactRecord(sinkArgs),
            redactedOutput: redactValue({ text: sinkResult.text, isError: sinkResult.isError }),
          });

          if (sinkResult.isError) {
            outcome = TestOutcome.TESTED_REJECTED;
            status = TestStatus.REJECTED;
            pathStatus = PathStatus.TESTED_REJECTED;
            notes = `Sink tool errored and blocked path execution: ${sinkResult.text}`;
          } else {
            // Brief settle delay so the mock sink finishes recording.
            await sleep(25);
            canaryObserved = ctx.sink.observed(canaryMarker);
            if (canaryObserved) {
              outcome = TestOutcome.TESTED_CONFIRMED;
              status = TestStatus.CONFIRMED;
              pathStatus = PathStatus.TESTED_CONFIRMED;
            } else {
              outcome = TestOutcome.TESTED_INCONCLUSIVE;
              status = TestStatus.INCONCLUSIVE;
              pathStatus = PathStatus.TESTED_INCONCLUSIVE;
              notes = 'Canary marker was not observed at the local mock sink; sink/tool behavior may be non-observable.';
            }
          }
        }
      }
    }
  } catch (err) {
    outcome = TestOutcome.TEST_ERROR;
    status = TestStatus.ERROR;
    pathStatus = PathStatus.TESTED_INCONCLUSIVE;
    notes = err instanceof Error ? err.message : String(err);
    recordEvidence('error', { message: notes });
  }

  recordEvidence('outcome', {
    status,
    outcome,
    pathStatus,
    canaryObserved,
    canaryExpected: canaryExpected ?? null,
    notes: notes ?? null,
  });

  const testRun: TestRun = {
    id: testRunId,
    collectionId: ctx.collectionId,
    profile: ctx.profile,
    testCaseId: planned.caseDef.id,
    testCaseName: planned.caseDef.name,
    candidatePathId: planned.candidatePathId,
    serverId: planned.serverId,
    sourceToolId: planned.sourceTool?.id,
    sinkToolId: planned.sinkTool?.id,
    pathSummary: planned.caseDef.pathSummary,
    plan: planned.caseDef.plan,
    toolCalls,
    canaryObserved,
    outcome,
    status,
    pathStatus,
    timestamp: startedAt,
    startedAt,
    completedAt: new Date().toISOString(),
    ...(canaryExpected ? { canaryExpected } : {}),
    ...(notes ? { notes } : {}),
  };

  return { testRun, evidence };
}

interface GithubSafeArtifactState {
  issueNumber?: number;
  issueUrl?: string;
  branchName?: string;
  branchRef?: string;
  pullNumber?: number;
  pullUrl?: string;
  filePath: string;
  fileUrl?: string;
  cleanupStatus: 'pending' | 'cleaned' | 'kept' | 'partial' | 'failed';
}

interface GithubSafeRunArgs {
  ctx: TestRunnerContext;
  planned: PlannedTest;
  testRunId: string;
  config: GithubSafeCanaryConfig;
}

function extractNumber(rawText: string, keys: string[]): number | undefined {
  for (const k of keys) {
    const r = new RegExp(`"${k}"\\s*:\\s*(\\d+)`, 'i').exec(rawText);
    if (r?.[1]) return Number(r[1]);
  }
  return undefined;
}

function extractUrl(rawText: string, keys: string[]): string | undefined {
  for (const k of keys) {
    const r = new RegExp(`"${k}"\\s*:\\s*"([^"]+)"`, 'i').exec(rawText);
    if (r?.[1]) return r[1];
  }
  return undefined;
}

function isProvenBlockedOrImpossible(text: string): boolean {
  return PROVEN_BLOCKED_OR_IMPOSSIBLE_RE.test(text);
}

function isBranchNotFound(text: string): boolean {
  return BRANCH_NOT_FOUND_RE.test(text);
}

function sanitizeBranchToken(value: string): string {
  let out = '';
  let prevDash = false;
  for (const ch of value) {
    const isAllowed =
      (ch >= 'a' && ch <= 'z') ||
      (ch >= 'A' && ch <= 'Z') ||
      (ch >= '0' && ch <= '9') ||
      ch === '.' ||
      ch === '_' ||
      ch === '-';
    const next = isAllowed ? ch : '-';
    if (next === '-') {
      if (prevDash) continue;
      prevDash = true;
    } else {
      prevDash = false;
    }
    out += next;
  }
  while (out.startsWith('-')) out = out.slice(1);
  while (out.endsWith('-')) out = out.slice(0, -1);
  return out;
}

function buildGithubSafeBranchName(branchPrefix: string, testRunId: string): string {
  const sanitized = sanitizeBranchToken(`${branchPrefix}${testRunId}`);
  const fallback = sanitizeBranchToken(branchPrefix);
  return (sanitized || fallback || 'iseemp-canary').slice(0, 200);
}

async function callAndRecord(
  args: GithubSafeRunArgs,
  toolCalls: ToolCall[],
  evidence: Evidence[],
  step: number,
  toolName: string,
  input: Record<string, unknown>,
): Promise<ToolCallResult> {
  const t0 = Date.now();
  const res = await args.ctx.invoke(args.planned.serverId, toolName, input);
  const durationMs = Date.now() - t0;
  const redactedInput = redactRecord(input);
  const redactedOutput = redactValue({ text: res.text, isError: res.isError });
  toolCalls.push({
    step,
    toolId: args.planned.sourceTool?.id,
    toolName,
    serverId: args.planned.serverId,
    input: redactedInput,
    output: redactedOutput,
    durationMs,
    ...(res.isError ? { error: res.text } : {}),
  });
  evidence.push({
    id: newId('evidence'),
    testRunId: args.testRunId,
    candidatePathId: args.planned.candidatePathId,
    type: 'tool_call',
    stepIndex: step,
    toolName,
    redactedInput,
    redactedOutput,
    content: {
      durationMs,
      isError: res.isError,
      sourceTool: args.planned.sourceTool?.name ?? null,
      timestamp: new Date().toISOString(),
    },
    createdAt: new Date().toISOString(),
  });
  return res;
}

async function tryCleanupGithubSafeArtifacts(
  args: GithubSafeRunArgs,
  artifacts: GithubSafeArtifactState,
  evidence: Evidence[],
): Promise<void> {
  if (args.config.keepArtifacts) {
    artifacts.cleanupStatus = 'kept';
    evidence.push({
      id: newId('evidence'),
      testRunId: args.testRunId,
      candidatePathId: args.planned.candidatePathId,
      type: 'cleanup',
      content: { keepArtifacts: true, status: 'kept' },
      createdAt: new Date().toISOString(),
    });
    return;
  }

  let failed = false;
  if (artifacts.branchName) {
    try {
      await args.ctx.invoke(args.planned.serverId, 'delete_branch', {
        owner: args.config.owner,
        repo: args.config.repo,
        branch: artifacts.branchName,
      });
    } catch {
      failed = true;
    }
  }
  if (artifacts.issueNumber) {
    try {
      await args.ctx.invoke(args.planned.serverId, 'update_issue', {
        owner: args.config.owner,
        repo: args.config.repo,
        issue_number: artifacts.issueNumber,
        state: 'closed',
      });
    } catch {
      failed = true;
    }
    try {
      await args.ctx.invoke(args.planned.serverId, 'delete_issue', {
        owner: args.config.owner,
        repo: args.config.repo,
        issue_number: artifacts.issueNumber,
      });
    } catch {
      // optional best effort
    }
  }

  artifacts.cleanupStatus = failed ? 'partial' : 'cleaned';
  evidence.push({
    id: newId('evidence'),
    testRunId: args.testRunId,
    candidatePathId: args.planned.candidatePathId,
    type: 'cleanup',
    content: {
      status: artifacts.cleanupStatus,
      branch: artifacts.branchName ?? null,
      issueNumber: artifacts.issueNumber ?? null,
    },
    createdAt: new Date().toISOString(),
  });
}

export async function executeGithubSafeCanaryPlannedTest(
  args: GithubSafeRunArgs,
): Promise<ExecutedTest> {
  const startedAt = new Date().toISOString();
  const toolCalls: ToolCall[] = [];
  const evidence: Evidence[] = [];
  const marker = `${args.config.canaryPrefix}-${args.testRunId}`;
  const artifacts: GithubSafeArtifactState = {
    filePath: `.iseemp/${args.config.canaryPrefix}-${args.testRunId}.txt`,
    cleanupStatus: 'pending',
  };

  evidence.push({
    id: newId('evidence'),
    testRunId: args.testRunId,
    candidatePathId: args.planned.candidatePathId,
    type: 'plan',
    content: {
      profile: 'github-safe-canary',
      testCaseId: args.planned.caseDef.id,
      marker,
      owner: args.config.owner,
      repo: args.config.repo,
      timestamp: startedAt,
    },
    createdAt: startedAt,
  });

  let step = 1;
  let canaryObserved = false;
  const canaryExpected = marker;
  let status: TestStatus = TestStatus.RUNNING;
  let outcome: TestOutcome = TestOutcome.TESTED_INCONCLUSIVE;
  let pathStatus: PathStatus = PathStatus.TESTED_INCONCLUSIVE;
  let notes: string | undefined;

  try {
    const tool = args.planned.sourceTool?.name;
    if (!tool) {
      outcome = TestOutcome.TEST_SKIPPED;
      status = TestStatus.INCONCLUSIVE;
      pathStatus = PathStatus.TESTED_INCONCLUSIVE;
      notes = 'Missing discovered source tool.';
    } else {
      const hasCreateOrUpdateFile = tool === 'create_or_update_file' || tool === 'push_files';
      if (hasCreateOrUpdateFile) {
        const branchName = buildGithubSafeBranchName(args.config.branchPrefix ?? '', args.testRunId);
        const writeInput = {
          owner: args.config.owner,
          repo: args.config.repo,
          path: artifacts.filePath,
          message: `${args.config.canaryPrefix}: canary write ${args.testRunId}`,
          // GitHub MCP create/update file tooling expects base64 content compatible with the GitHub contents API.
          content: Buffer.from(`${marker}\n`).toString('base64'),
          branch: branchName,
        };
        let writeRes = await callAndRecord(args, toolCalls, evidence, step++, tool, writeInput);
        let usedDefaultBranchFallback = false;
        if (writeRes.isError && isBranchNotFound(writeRes.text)) {
          const fallbackInput = {
            owner: args.config.owner,
            repo: args.config.repo,
            path: artifacts.filePath,
            message: `${args.config.canaryPrefix}: canary write ${args.testRunId}`,
            content: Buffer.from(`${marker}\n`).toString('base64'),
          };
          writeRes = await callAndRecord(args, toolCalls, evidence, step++, tool, fallbackInput);
          usedDefaultBranchFallback = !writeRes.isError;
        }
        if (writeRes.isError) {
          if (isProvenBlockedOrImpossible(writeRes.text)) {
            outcome = TestOutcome.TESTED_REJECTED;
            status = TestStatus.REJECTED;
            pathStatus = PathStatus.TESTED_REJECTED;
            notes = `Write path blocked: ${writeRes.text}`;
          } else {
            outcome = TestOutcome.TESTED_INCONCLUSIVE;
            status = TestStatus.INCONCLUSIVE;
            pathStatus = PathStatus.TESTED_INCONCLUSIVE;
            notes = `Write path unproven: ${writeRes.text}`;
          }
        } else {
          // Only keep a branch handle when the branch-targeted write succeeded;
          // default-branch fallback does not create an isolated branch to clean up.
          if (!usedDefaultBranchFallback) {
            artifacts.branchName = branchName;
          }
          const readBackInput: Record<string, unknown> = {
            owner: args.config.owner,
            repo: args.config.repo,
            path: artifacts.filePath,
          };
          if (artifacts.branchName) {
            readBackInput['ref'] = artifacts.branchName;
          }
          const readBack = await args.ctx.invoke(args.planned.serverId, 'get_file_contents', readBackInput);
          canaryObserved = !readBack.isError && readBack.text.includes(marker);
          outcome = canaryObserved ? TestOutcome.TESTED_CONFIRMED : TestOutcome.TESTED_INCONCLUSIVE;
          status = canaryObserved ? TestStatus.CONFIRMED : TestStatus.INCONCLUSIVE;
          pathStatus = canaryObserved
            ? PathStatus.TESTED_CONFIRMED
            : PathStatus.TESTED_INCONCLUSIVE;
          notes = canaryObserved
            ? usedDefaultBranchFallback
              ? 'Canary observed in controlled file readback after default-branch fallback.'
              : 'Canary observed in controlled file readback.'
            : usedDefaultBranchFallback
              ? 'No canary observed in controlled file readback after default-branch fallback.'
              : 'No canary observed in controlled file readback.';
        }
      } else if (ISSUE_PR_TOOL_NAME_RE.test(tool)) {
        const title = `${args.config.issuePrefix}${args.testRunId}`;
        const issueRes = await callAndRecord(args, toolCalls, evidence, step++, tool, {
          owner: args.config.owner,
          repo: args.config.repo,
          title,
          body: `${marker}\ncontrolled:${args.testRunId}`,
        });
        if (issueRes.isError) {
          if (isProvenBlockedOrImpossible(issueRes.text)) {
            outcome = TestOutcome.TESTED_REJECTED;
            status = TestStatus.REJECTED;
            pathStatus = PathStatus.TESTED_REJECTED;
            notes = `Issue/PR write blocked: ${issueRes.text}`;
          } else {
            outcome = TestOutcome.TESTED_INCONCLUSIVE;
            status = TestStatus.INCONCLUSIVE;
            pathStatus = PathStatus.TESTED_INCONCLUSIVE;
            notes = `Issue/PR write unproven: ${issueRes.text}`;
          }
        } else {
          artifacts.issueNumber = extractNumber(issueRes.text, ['number', 'issue_number']);
          artifacts.issueUrl = extractUrl(issueRes.text, ['html_url', 'url']);
          canaryObserved = issueRes.text.includes(marker);
          outcome = canaryObserved ? TestOutcome.TESTED_CONFIRMED : TestOutcome.TESTED_INCONCLUSIVE;
          status = canaryObserved ? TestStatus.CONFIRMED : TestStatus.INCONCLUSIVE;
          pathStatus = canaryObserved
            ? PathStatus.TESTED_CONFIRMED
            : PathStatus.TESTED_INCONCLUSIVE;
          notes = canaryObserved
            ? 'Canary observed in controlled issue/PR write response.'
            : 'No canary observed in controlled issue/PR response.';
        }
      } else if (READ_TOOL_NAME_RE.test(tool)) {
        const readRes = await callAndRecord(args, toolCalls, evidence, step++, tool, {
          owner: args.config.owner,
          repo: args.config.repo,
          query: marker,
          path: artifacts.filePath,
        });
        if (readRes.isError) {
          outcome = isProvenBlockedOrImpossible(readRes.text)
            ? TestOutcome.TESTED_REJECTED
            : TestOutcome.TESTED_INCONCLUSIVE;
          status = outcome === TestOutcome.TESTED_REJECTED ? TestStatus.REJECTED : TestStatus.INCONCLUSIVE;
          pathStatus =
            outcome === TestOutcome.TESTED_REJECTED
              ? PathStatus.TESTED_REJECTED
              : PathStatus.TESTED_INCONCLUSIVE;
          notes = readRes.text;
        } else {
          canaryObserved = readRes.text.includes(marker);
          outcome = canaryObserved ? TestOutcome.TESTED_CONFIRMED : TestOutcome.TESTED_INCONCLUSIVE;
          status = canaryObserved ? TestStatus.CONFIRMED : TestStatus.INCONCLUSIVE;
          pathStatus = canaryObserved
            ? PathStatus.TESTED_CONFIRMED
            : PathStatus.TESTED_INCONCLUSIVE;
          notes = canaryObserved
            ? 'Canary observed in controlled read/search output.'
            : 'No canary observed in controlled read/search output.';
        }
      } else if (args.planned.sourceTool && isGithubExternalSendLikeTool(args.planned.sourceTool)) {
        outcome = TestOutcome.TEST_SKIPPED;
        status = TestStatus.INCONCLUSIVE;
        pathStatus = PathStatus.TESTED_INCONCLUSIVE;
        notes = 'External-send-like tool present but no controlled observable sink was discovered.';
      } else {
        outcome = TestOutcome.TEST_SKIPPED;
        status = TestStatus.INCONCLUSIVE;
        pathStatus = PathStatus.TESTED_INCONCLUSIVE;
        notes = 'Tool category not supported by github-safe-canary profile.';
      }
    }
  } catch (err) {
    outcome = TestOutcome.TEST_ERROR;
    status = TestStatus.ERROR;
    pathStatus = PathStatus.TESTED_INCONCLUSIVE;
    notes = err instanceof Error ? err.message : String(err);
  } finally {
    await tryCleanupGithubSafeArtifacts(args, artifacts, evidence);
  }

  evidence.push({
    id: newId('evidence'),
    testRunId: args.testRunId,
    candidatePathId: args.planned.candidatePathId,
    type: 'outcome',
    content: {
      status,
      outcome,
      pathStatus,
      canaryObserved,
      canaryExpected,
      notes: notes ?? null,
      artifacts: {
        issueNumber: artifacts.issueNumber ?? null,
        issueUrl: artifacts.issueUrl ?? null,
        branchName: artifacts.branchName ?? null,
        filePath: artifacts.filePath,
        fileUrl: artifacts.fileUrl ?? null,
        pullNumber: artifacts.pullNumber ?? null,
        pullUrl: artifacts.pullUrl ?? null,
      },
      cleanupStatus: artifacts.cleanupStatus,
      toolCallSequence: toolCalls.map((t) => t.toolName),
    },
    createdAt: new Date().toISOString(),
  });

  const testRun: TestRun = {
    id: args.testRunId,
    collectionId: args.ctx.collectionId,
    profile: args.ctx.profile,
    testCaseId: args.planned.caseDef.id,
    testCaseName: args.planned.caseDef.name,
    candidatePathId: args.planned.candidatePathId,
    serverId: args.planned.serverId,
    sourceToolId: args.planned.sourceTool?.id,
    sinkToolId: args.planned.sinkTool?.id,
    pathSummary: args.planned.caseDef.pathSummary,
    plan: args.planned.caseDef.plan,
    toolCalls,
    canaryObserved,
    canaryExpected,
    outcome,
    status,
    pathStatus,
    startedAt,
    completedAt: new Date().toISOString(),
    notes,
    timestamp: startedAt,
  };
  return { testRun, evidence };
}

/**
 * Pick a deterministic-looking marker out of the source-tool response.
 * Any "CANARY-..." token wins — this is reliable.
 *
 * If no CANARY- token is present, the source tool returned real/unexpected
 * data. We return null to signal the caller should treat the result as
 * inconclusive rather than risk a false negative by using an unreliable marker.
 */
function pickCanaryMarker(text: string): string | null {
  const m = text.match(/CANARY-[A-Za-z0-9_-]+/);
  if (m) return m[0];
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Map a TestRun's pathStatus to the `confidence`, `severity`, and flags that a
 * downstream finding should carry. Used by `applyTestResultsToFindings`.
 */
export function summariseRuns(runs: TestRun[]): {
  hasConfirmed: boolean;
  hasRejected: boolean;
  hasInconclusive: boolean;
} {
  return {
    hasConfirmed: runs.some((r) => r.pathStatus === PathStatus.TESTED_CONFIRMED),
    hasRejected: runs.some((r) => r.pathStatus === PathStatus.TESTED_REJECTED),
    hasInconclusive: runs.some(
      (r) =>
        r.pathStatus === PathStatus.TESTED_INCONCLUSIVE ||
        r.pathStatus === PathStatus.STATIC_POSSIBLE,
    ),
  };
}

export function bumpConfidence(c: Confidence | undefined): Confidence {
  if (c === 'high') return 'high';
  if (c === 'medium') return 'high';
  return 'medium';
}

export function downgradeConfidence(c: Confidence | undefined): Confidence {
  if (c === 'high') return 'medium';
  if (c === 'medium') return 'low';
  return 'low';
}

export function bumpSeverity(s: 'critical' | 'high' | 'medium' | 'low' | 'info'): 'critical' | 'high' | 'medium' | 'low' | 'info' {
  if (s === 'low' || s === 'info') return 'medium';
  if (s === 'medium') return 'high';
  return s;
}

export function downgradeSeverity(
  s: 'critical' | 'high' | 'medium' | 'low' | 'info',
): 'critical' | 'high' | 'medium' | 'low' | 'info' {
  if (s === 'critical') return 'medium';
  if (s === 'high') return 'low';
  if (s === 'medium') return 'low';
  return s;
}
