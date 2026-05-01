import { describe, it, expect } from 'vitest';
import { Capability, PathStatus, TestStatus, TestOutcome } from '@iseemp/core';
import type { ToolRow, ServerRow } from '@iseemp/storage';
import { planSafeProfile, executePlannedTest, SAFE_PROFILE_CASES } from '../runner.js';
import { startMockSink } from '../sink.js';

function tool(id: string, name: string, caps: Capability[]): ToolRow {
  return {
    id,
    collection_id: 'col1',
    server_id: 'srv1',
    name,
    description: null,
    input_schema: null,
    capabilities: JSON.stringify(caps),
    risk_score: 50,
    created_at: new Date().toISOString(),
  };
}

function server(): ServerRow {
  return {
    id: 'srv1',
    collection_id: 'col1',
    name: 'canary-mcp',
    url: null,
    command: 'node',
    args: null,
    env: null,
    transport: 'stdio',
    is_verified: 0,
    created_at: new Date().toISOString(),
  };
}

describe('planSafeProfile', () => {
  it('plans the three required test cases when capabilities match', () => {
    const tools = [
      tool('t-secret', 'read_secret', [Capability.READ_SECRET_HIGH]),
      tool('t-meta', 'read_team_metadata', [Capability.READ_SENSITIVE_MEDIUM]),
      tool('t-send', 'send_webhook', [Capability.SEND_HTTP, Capability.SEND_EXTERNAL]),
      tool('t-mut', 'mutate_remote_state', [Capability.MUTATE_REMOTE_STATE]),
    ];
    const map = new Map<string, ToolRow[]>([['srv1', tools]]);
    const planned = planSafeProfile([server()], map);
    const ids = planned.map((p) => p.caseDef.id).sort();
    expect(ids).toEqual([
      'MUTATE_REMOTE_STATE_EXPOSED',
      'READ_SENSITIVE_MEDIUM_TO_SEND_EXTERNAL',
      'READ_SECRET_HIGH_TO_SEND_EXTERNAL',
    ].sort());
    expect(SAFE_PROFILE_CASES).toHaveLength(3);
    expect(planned.every((p) => !!p.candidatePathId)).toBe(true);
  });

  it('skips chain test cases when no sink tool exists', () => {
    const tools = [tool('t-secret', 'read_secret', [Capability.READ_SECRET_HIGH])];
    const planned = planSafeProfile([server()], new Map([['srv1', tools]]));
    expect(planned.map((p) => p.caseDef.id)).toEqual([]);
  });
});

describe('executePlannedTest', () => {
  it('marks tested_confirmed when canary reaches the sink', async () => {
    const sink = await startMockSink();
    try {
      const tools = [
        tool('t-secret', 'read_secret', [Capability.READ_SECRET_HIGH]),
        tool('t-send', 'send_webhook', [Capability.SEND_HTTP, Capability.SEND_EXTERNAL]),
      ];
      const planned = planSafeProfile([server()], new Map([['srv1', tools]]));
      const secretCase = planned.find((p) => p.caseDef.id === 'READ_SECRET_HIGH_TO_SEND_EXTERNAL');
      expect(secretCase).toBeDefined();

      const ctx = {
        collectionId: 'col1',
        profile: 'safe' as const,
        sink,
        invoke: async (_serverId: string, toolName: string, args: Record<string, unknown>) => {
          if (toolName === 'read_secret') {
            return {
              raw: null,
              text: JSON.stringify({ name: args['name'], value: 'CANARY-SECRET-from-test' }),
              isError: false,
            };
          }
          if (toolName === 'send_webhook') {
            // Forward payload to the mock sink so observed() returns true.
            await fetch(args['url'] as string, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: args['payload'] as string,
            });
            return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
          }
          throw new Error('unexpected tool: ' + toolName);
        },
      };

      const executed = await executePlannedTest(ctx, secretCase!);
      expect(executed.testRun.status).toBe(TestStatus.CONFIRMED);
      expect(executed.testRun.outcome).toBe(TestOutcome.TESTED_CONFIRMED);
      expect(executed.testRun.pathStatus).toBe(PathStatus.TESTED_CONFIRMED);
      expect(executed.testRun.canaryObserved).toBe(true);
      expect(executed.testRun.toolCalls).toHaveLength(2);
      // Evidence: plan + 2 tool_calls + outcome
      expect(executed.evidence.length).toBeGreaterThanOrEqual(4);
      // Outputs are redacted-via-redactValue but text is preserved as-is for non-secret keys.
      const firstCallEvidence = executed.evidence.find((e) => e.type === 'tool_call');
      expect(firstCallEvidence).toBeDefined();
    } finally {
      await sink.close();
    }
  });

  it('marks tested_inconclusive when canary never reaches the sink', async () => {
    const sink = await startMockSink();
    try {
      const tools = [
        tool('t-meta', 'read_team_metadata', [Capability.READ_SENSITIVE_MEDIUM]),
        tool('t-send', 'send_webhook', [Capability.SEND_HTTP, Capability.SEND_EXTERNAL]),
      ];
      const planned = planSafeProfile([server()], new Map([['srv1', tools]]));
      const metaCase = planned.find(
        (p) => p.caseDef.id === 'READ_SENSITIVE_MEDIUM_TO_SEND_EXTERNAL',
      )!;

      const ctx = {
        collectionId: 'col1',
        profile: 'safe' as const,
        sink,
        invoke: async (_serverId: string, toolName: string, _args: Record<string, unknown>) => {
          if (toolName === 'read_team_metadata') {
            return {
              raw: null,
              text: JSON.stringify({ marker: 'CANARY-METADATA-abc' }),
              isError: false,
            };
          }
          // sink tool succeeds but does NOT forward (simulates a server that
          // refuses external sends or has a guardrail).
          return { raw: null, text: JSON.stringify({ ok: true, blocked: true }), isError: false };
        },
      };

      const executed = await executePlannedTest(ctx, metaCase);
      expect(executed.testRun.outcome).toBe(TestOutcome.TESTED_INCONCLUSIVE);
      expect(executed.testRun.pathStatus).toBe(PathStatus.TESTED_INCONCLUSIVE);
      expect(executed.testRun.canaryObserved).toBe(false);
    } finally {
      await sink.close();
    }
  });

  it('confirms exposure for MUTATE_REMOTE_STATE without external send', async () => {
    const sink = await startMockSink();
    try {
      const tools = [tool('t-mut', 'mutate_remote_state', [Capability.MUTATE_REMOTE_STATE])];
      const planned = planSafeProfile([server()], new Map([['srv1', tools]]));
      const mutCase = planned.find((p) => p.caseDef.id === 'MUTATE_REMOTE_STATE_EXPOSED')!;

      const ctx = {
        collectionId: 'col1',
        profile: 'safe' as const,
        sink,
        invoke: async () => ({
          raw: null,
          text: JSON.stringify({ ok: true, mutated: true }),
          isError: false,
        }),
      };

      const executed = await executePlannedTest(ctx, mutCase);
      expect(executed.testRun.outcome).toBe(TestOutcome.TESTED_CONFIRMED);
      expect(executed.testRun.pathStatus).toBe(PathStatus.TESTED_CONFIRMED);
      expect(executed.testRun.toolCalls).toHaveLength(1);
    } finally {
      await sink.close();
    }
  });
});
