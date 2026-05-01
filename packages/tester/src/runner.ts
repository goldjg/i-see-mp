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
  | 'MUTATE_REMOTE_STATE_EXPOSED';

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
  profile: 'safe' | 'demo-confirm';
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
