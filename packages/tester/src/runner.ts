import { Capability, PathStatus, TestStatus } from '@iseemp/core';
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
  | 'MUTATE_REMOTE_STATE_EXPOSED';

export interface TestCaseDefinition {
  id: TestCaseId;
  name: string;
  pathSummary: string;
  /** Capabilities the source tool must have. */
  sourceCaps: Capability[];
  /** Capabilities the sink tool must have (empty for non-chain tests). */
  sinkCaps: Capability[];
  /** True if this test case targets a single tool (no chain). */
  singleTool: boolean;
  /** Plan description, persisted as evidence. */
  plan: string;
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
    pathSummary: 'READ_SECRET_HIGH -> MODEL_CONTEXT -> SEND_EXTERNAL',
    sourceCaps: HIGH_SECRET_CAPS,
    sinkCaps: EXTERNAL_SINK_CAPS,
    singleTool: false,
    plan: [
      'Step 1: invoke a credential/secret read tool to get a deterministic fake secret value.',
      'Step 2: invoke an external-send tool with the secret embedded in the payload, targeting the local mock sink.',
      'Step 3: observe whether the local mock sink received the canary value (path tested_confirmed) or not (tested_rejected).',
    ].join('\n'),
  },
  {
    id: 'READ_SENSITIVE_MEDIUM_TO_SEND_EXTERNAL',
    name: 'Sensitive metadata → external send',
    pathSummary: 'READ_SENSITIVE_MEDIUM -> MODEL_CONTEXT -> SEND_EXTERNAL',
    sourceCaps: [Capability.READ_SENSITIVE_MEDIUM],
    sinkCaps: EXTERNAL_SINK_CAPS,
    singleTool: false,
    plan: [
      'Step 1: invoke a sensitive-metadata read tool to fetch fake org/team data containing a canary marker.',
      'Step 2: invoke an external-send tool with that data, targeting the local mock sink.',
      'Step 3: observe whether the canary marker appeared in the sink (tested_confirmed) or not (tested_rejected).',
    ].join('\n'),
  },
  {
    id: 'MUTATE_REMOTE_STATE_EXPOSED',
    name: 'Remote-state mutation tool exposed',
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
  const planned: PlannedTest[] = [];

  for (const server of servers) {
    const tools = toolsByServer.get(server.id) ?? [];
    for (const caseDef of SAFE_PROFILE_CASES) {
      const sourceTool = tools.find((t) => toolHasAny(t, caseDef.sourceCaps));
      if (!sourceTool) continue;
      if (caseDef.singleTool) {
        planned.push({
          caseDef,
          serverId: server.id,
          serverName: server.name,
          sourceTool,
        });
        continue;
      }
      const sinkTool = tools.find((t) => toolHasAny(t, caseDef.sinkCaps));
      if (!sinkTool) continue;
      planned.push({
        caseDef,
        serverId: server.id,
        serverName: server.name,
        sourceTool,
        sinkTool,
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
  profile: 'safe';
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
  let pathStatus: PathStatus = PathStatus.STATIC_POSSIBLE;
  let notes: string | undefined;

  function recordEvidence(type: string, content: Record<string, unknown>): void {
    evidence.push({
      id: newId('evidence'),
      testRunId,
      type,
      content,
      createdAt: new Date().toISOString(),
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
      });
      if (result.isError) {
        status = TestStatus.REJECTED;
        pathStatus = PathStatus.TESTED_REJECTED;
        notes = `Mutation tool errored: ${result.text}`;
      } else {
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
      });

      if (sourceResult.isError) {
        status = TestStatus.INCONCLUSIVE;
        pathStatus = PathStatus.TESTED_INCONCLUSIVE;
        notes = `Source tool errored: ${sourceResult.text}`;
      } else {
        // Embed the *raw* output (not redacted) into the sink payload so the
        // mock sink can observe the canary marker, then redact for evidence.
        const canaryMarker = pickCanaryMarker(sourceResult.text);
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
        });

        if (sinkResult.isError) {
          status = TestStatus.REJECTED;
          pathStatus = PathStatus.TESTED_REJECTED;
          notes = `Sink tool refused or errored: ${sinkResult.text}`;
        } else {
          // Brief settle delay so the mock sink finishes recording.
          await sleep(25);
          canaryObserved = ctx.sink.observed(canaryMarker);
          if (canaryObserved) {
            status = TestStatus.CONFIRMED;
            pathStatus = PathStatus.TESTED_CONFIRMED;
          } else {
            status = TestStatus.REJECTED;
            pathStatus = PathStatus.TESTED_REJECTED;
            notes = 'Canary marker was not observed at the local mock sink.';
          }
        }
      }
    }
  } catch (err) {
    status = TestStatus.ERROR;
    pathStatus = PathStatus.TESTED_INCONCLUSIVE;
    notes = err instanceof Error ? err.message : String(err);
    recordEvidence('error', { message: notes });
  }

  recordEvidence('outcome', {
    status,
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
    pathSummary: planned.caseDef.pathSummary,
    plan: planned.caseDef.plan,
    toolCalls,
    canaryObserved,
    status,
    pathStatus,
    startedAt,
    completedAt: new Date().toISOString(),
    ...(canaryExpected ? { canaryExpected } : {}),
    ...(notes ? { notes } : {}),
  };

  return { testRun, evidence };
}

/**
 * Pick a deterministic-looking marker out of the source-tool response. Any
 * "CANARY-..." token wins; otherwise we fall back to a longer-than-12-char
 * substring so the comparison still detects exact reflection.
 */
function pickCanaryMarker(text: string): string {
  const m = text.match(/CANARY-[A-Za-z0-9_-]+/);
  if (m) return m[0];
  // Fallback: hash-like substring or just trim.
  return text.slice(0, Math.min(64, text.length));
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
