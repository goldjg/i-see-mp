import { describe, it, expect, vi } from 'vitest';
import { Capability, PathStatus, TestStatus, TestOutcome } from '@iseemp/core';
import type { ToolRow, ServerRow } from '@iseemp/storage';
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
  captureBaselinePlan,
  detectBehaviouralDeviation,
  isSecondaryRateLimit,
  isProvenBlockedOrImpossible,
  SAFE_PROFILE_CASES,
  DEMO_CONFIRM_PROFILE_CASES,
  GITHUB_SAFE_CANARY_PROFILE_CASES,
} from '../runner.js';
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
    source_role: JSON.stringify([]),
    is_untrusted: 0,
    is_instruction_capable: 0,
    content_origin: 'local',
    trust_zone: null,
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

describe('planDemoConfirmProfile', () => {
  it('plans the three deterministic demo-confirm cases with preferred tools', () => {
    const tools = [
      tool('t-secret', 'read_secret_canary', [Capability.READ_SECRET_HIGH]),
      tool('t-meta', 'read_metadata', [Capability.READ_METADATA_LOW]),
      tool('t-send', 'send_to_mock_sink', [Capability.SEND_HTTP, Capability.SEND_EXTERNAL]),
      tool('t-block', 'blocked_send', [Capability.SEND_HTTP, Capability.SEND_EXTERNAL]),
      tool('t-mut', 'mutate_remote_state', [Capability.MUTATE_REMOTE_STATE]),
    ];
    const planned = planDemoConfirmProfile([server()], new Map([['srv1', tools]]));
    const ids = planned.map((p) => p.caseDef.id).sort();
    expect(ids).toEqual([
      'MUTATE_REMOTE_STATE_EXPOSED',
      'READ_METADATA_LOW_TO_SEND_EXTERNAL',
      'READ_SECRET_HIGH_TO_SEND_EXTERNAL',
    ].sort());
    expect(DEMO_CONFIRM_PROFILE_CASES).toHaveLength(3);
  });
});

describe('github-safe-canary planning and refusal gates', () => {
  it('refuses when explicit selection/config/safe-repo gates are not met', () => {
    const refusal = assessGithubSafeCanaryRefusal('github-safe-canary', undefined, false);
    expect(refusal.refused).toBe(true);
    expect(refusal.reasons.length).toBeGreaterThan(0);
  });

  it('allows run when config is complete and repo matches safe pattern', () => {
    const refusal = assessGithubSafeCanaryRefusal(
      'github-safe-canary',
      {
        owner: 'octo-org',
        repo: 'canary-sandbox',
        branchPrefix: 'iseemp-',
        issuePrefix: 'ISEEMP-',
        canaryPrefix: 'ISEEMP',
      },
      true,
    );
    expect(refusal.refused).toBe(false);
  });

  it('plans only against github-like servers and discovered tool categories', () => {
    const githubSrv = { ...server(), name: 'github-mcp' };
    const otherSrv = { ...server(), id: 'srv2', name: 'not-github', collection_id: 'col1' };
    const githubTools = [
      tool('t1', 'get_file_contents', [Capability.READ_REMOTE_DATA]),
      tool('t2', 'create_issue', [Capability.MUTATE_ISSUE_OR_PR]),
      tool('t3', 'create_or_update_file', [Capability.MUTATE_REPOSITORY]),
    ];
    const nonGithubTools = [tool('x1', 'read_file', [Capability.READ_LOCAL_FILE])];
    const planned = planGithubSafeCanaryProfile(
      [githubSrv, otherSrv],
      new Map([
        ['srv1', githubTools],
        ['srv2', nonGithubTools],
      ]),
    );
    expect(planned.length).toBe(3);
    expect(planned.every((p) => p.serverId === 'srv1')).toBe(true);
    expect(GITHUB_SAFE_CANARY_PROFILE_CASES.length).toBe(4);
  });

  it('does not misclassify repository mutation tools as issue/pr write tools', () => {
    const githubSrv = { ...server(), name: 'github-mcp' };
    const githubTools = [
      tool('t-read', 'get_file_contents', [Capability.READ_REMOTE_DATA]),
      tool('t-issue', 'create_issue', [Capability.MUTATE_ISSUE_OR_PR]),
      tool('t-repo', 'create_or_update_file', [Capability.MUTATE_REMOTE_STATE]),
    ];
    const planned = planGithubSafeCanaryProfile([githubSrv], new Map([['srv1', githubTools]]));
    const issueCase = planned.find((p) => p.caseDef.id === 'GITHUB_ISSUE_PR_WRITE_CONTROLLED_ARTIFACT');
    const repoCase = planned.find((p) => p.caseDef.id === 'GITHUB_REPOSITORY_MUTATION_CONTROLLED_ARTIFACT');
    expect(issueCase?.sourceTool?.name).toBe('create_issue');
    expect(repoCase?.sourceTool?.name).toBe('create_or_update_file');
  });

  it('prefers issue creation tools over comment tools for controlled issue canaries', () => {
    const githubSrv = { ...server(), name: 'github-mcp' };
    const githubTools = [
      tool('t-comment', 'add_issue_comment', [Capability.MUTATE_ISSUE_OR_PR]),
      tool('t-issue', 'issue_write', [Capability.MUTATE_ISSUE_OR_PR]),
    ];
    const planned = planGithubSafeCanaryProfile([githubSrv], new Map([['srv1', githubTools]]));
    const issueCase = planned.find((p) => p.caseDef.id === 'GITHUB_ISSUE_PR_WRITE_CONTROLLED_ARTIFACT');
    expect(issueCase?.sourceTool?.name).toBe('issue_write');
  });

  it('prefers compatible repository/file read tools over issue-specific getters', () => {
    const githubSrv = { ...server(), name: 'github-mcp' };
    const githubTools = [
      tool('t-issue-read', 'get_issue', [Capability.READ_REMOTE_DATA]),
      tool('t-file-read', 'get_file_contents', [Capability.READ_REMOTE_DATA]),
    ];
    const planned = planGithubSafeCanaryProfile([githubSrv], new Map([['srv1', githubTools]]));
    const readCase = planned.find((p) => p.caseDef.id === 'GITHUB_READ_CONTROLLED_ARTIFACT');
    expect(readCase?.sourceTool?.name).toBe('get_file_contents');
  });

  it('still prefers get_file_contents when multiple read tools are present', () => {
    const githubSrv = { ...server(), name: 'github-mcp' };
    const githubTools = [
      tool('t-search', 'search_code', [Capability.READ_REMOTE_DATA]),
      tool('t-read', 'get_file_contents', [Capability.READ_REMOTE_DATA]),
      tool('t-list', 'list_commits', [Capability.READ_REMOTE_DATA]),
    ];
    const planned = planGithubSafeCanaryProfile([githubSrv], new Map([['srv1', githubTools]]));
    const readCase = planned.find((p) => p.caseDef.id === 'GITHUB_READ_CONTROLLED_ARTIFACT');
    expect(readCase?.sourceTool?.name).toBe('get_file_contents');
  });
});

describe('prompt-injection-github planning', () => {
  it('plans prompt injection case when issue_read and sink tool exist', () => {
    const githubSrv = { ...server(), name: 'github-mcp' };
    const githubTools = [
      tool('t-read', 'issue_read', [Capability.UNTRUSTED_CONTENT_EXPOSURE, Capability.READ_REMOTE_DATA]),
      tool('t-send', 'send_http_request', [Capability.SEND_HTTP, Capability.SEND_EXTERNAL]),
    ];
    const planned = planPromptInjectionGithubProfile(
      [githubSrv],
      new Map([['srv1', githubTools]]),
    );
    expect(planned.some((p) => p.caseDef.id === 'PROMPT_INJECTION_GITHUB_ISSUE_TO_SINK')).toBe(true);
  });
});

describe('baseline/deviation helpers', () => {
  it('detects no deviation when injected calls match baseline tools', async () => {
    const baseline = await captureBaselinePlan(
      {
        call: async () => ({ raw: null, text: 'ok', isError: false }),
      },
      'issue_read',
      { issue: 1 },
      'srv1',
      { issue_read: [Capability.UNTRUSTED_CONTENT_EXPOSURE] },
    );
    const report = detectBehaviouralDeviation(
      baseline,
      [
        {
          step: 1,
          toolName: 'issue_read',
          serverId: 'srv1',
          input: { issue: 1 },
          output: { ok: true },
        },
      ],
      'ISEEMP-EXFIL-x',
    );
    expect(report.deviationDetected).toBe(false);
    expect(report.injectionConfirmed).toBe(false);
  });

  it('detects tool + sequence deviation and exfil marker', async () => {
    const baseline = await captureBaselinePlan(
      {
        call: async () => ({ raw: null, text: 'ok', isError: false }),
      },
      'issue_read',
      { issue: 1 },
      'srv1',
      {
        issue_read: [Capability.UNTRUSTED_CONTENT_EXPOSURE],
        send_http_request: [Capability.SEND_HTTP, Capability.SEND_EXTERNAL],
      },
    );
    const report = detectBehaviouralDeviation(
      baseline,
      [
        {
          step: 1,
          toolName: 'issue_read',
          serverId: 'srv1',
          input: { issue: 1 },
          output: { ok: true },
        },
        {
          step: 2,
          toolName: 'send_http_request',
          serverId: 'srv1',
          input: { payload: 'ISEEMP-EXFIL-abc' },
          output: { ok: true },
        },
      ],
      'ISEEMP-EXFIL-abc',
    );
    expect(report.deviationDetected).toBe(true);
    expect(report.injectionConfirmed).toBe(true);
    expect(report.events.some((e) => e.type === 'PROMPT_INJECTION_DEVIATION')).toBe(true);
    expect(report.events.some((e) => e.type === 'SEQUENCE_DEVIATION')).toBe(true);
    expect(report.events.some((e) => e.type === 'EXFIL_MARKER_OBSERVED')).toBe(true);
  });
});

describe('executePromptInjectionGithubPlannedTest', () => {
  it('marks confirmed when controlled sink observes exfil marker', async () => {
    const githubSrv = { ...server(), name: 'github-mcp' };
    const planned = planPromptInjectionGithubProfile(
      [githubSrv],
      new Map([
        [
          'srv1',
          [
            tool('t-read', 'issue_read', [Capability.UNTRUSTED_CONTENT_EXPOSURE, Capability.READ_REMOTE_DATA]),
            tool('t-send', 'send_http_request', [Capability.SEND_HTTP, Capability.SEND_EXTERNAL]),
          ],
        ],
      ]),
    )[0];
    expect(planned).toBeDefined();
    const sink = await startMockSink();
    try {
      const executed = await executePromptInjectionGithubPlannedTest({
        ctx: {
          collectionId: 'col1',
          profile: 'prompt-injection-github',
          sink,
          invoke: async (_serverId, toolName, args) => {
            if (toolName === 'create_issue') {
              return { raw: null, text: '{"number": 1}', isError: false };
            }
            if (toolName === 'issue_read') {
              return { raw: null, text: 'read ok', isError: false };
            }
            if (toolName === 'send_http_request') {
              await fetch(sink.url, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(args),
              });
              return { raw: null, text: 'sent', isError: false };
            }
            if (toolName === 'update_issue' || toolName === 'delete_issue') {
              return { raw: null, text: 'ok', isError: false };
            }
            return { raw: null, text: 'unsupported', isError: true };
          },
        },
        planned: planned!,
        testRunId: 'testrun:promptinj:test',
        config: {
          owner: 'octo-org',
          repo: 'canary-sandbox',
          issuePrefix: 'ISEEMP-',
          canaryPrefix: 'ISEEMP',
        },
      });
      expect(executed.testRun.outcome).toBe(TestOutcome.TESTED_CONFIRMED);
      expect(executed.testRun.pathStatus).toBe(PathStatus.TESTED_CONFIRMED);
      expect(executed.testRun.canaryObserved).toBe(true);
      expect(executed.testRun.deviationDetected).toBe(true);
      expect(executed.testRun.injectionConfirmed).toBe(true);
      expect(executed.testRun.baselineToolCalls?.length).toBeGreaterThan(0);
      expect(executed.testRun.injectedToolCalls?.length).toBeGreaterThan(0);
    } finally {
      await sink.close();
    }
  });
});

describe('executePromptInjectionFetchPlannedTest', () => {
  it('marks confirmed when exfil marker is sent to sink', async () => {
    const planned = planPromptInjectionFetchProfile(
      [server()],
      new Map([
        [
          'srv1',
          [
            tool('t-fetch', 'web_fetch', [Capability.UNTRUSTED_CONTENT_EXPOSURE, Capability.READ_REMOTE_DATA]),
            tool('t-send', 'send_http_request', [Capability.SEND_HTTP, Capability.SEND_EXTERNAL]),
          ],
        ],
      ]),
    )[0];
    expect(planned).toBeDefined();
    const sink = await startMockSink();
    try {
      const executed = await executePromptInjectionFetchPlannedTest(
        {
          collectionId: 'col1',
          profile: 'prompt-injection-fetch',
          sink,
          invoke: async (_serverId, toolName, args) => {
            if (toolName === 'send_http_request') {
              await fetch(sink.url, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(args),
              });
            }
            return { raw: null, text: 'ok', isError: false };
          },
        },
        planned!,
        'testrun:promptinjfetch:test',
      );
      expect(executed.testRun.outcome).toBe(TestOutcome.TESTED_CONFIRMED);
      expect(executed.testRun.injectionConfirmed).toBe(true);
      expect(executed.testRun.deviationDetected).toBe(true);
    } finally {
      await sink.close();
    }
  });
});

describe('github-safe regex helpers', () => {
  it('identifies secondary rate limit responses', () => {
    expect(isSecondaryRateLimit('403 secondary rate limit exceeded')).toBe(true);
    expect(isSecondaryRateLimit('rate limit exceeded for this endpoint')).toBe(true);
  });

  it('does not classify secondary rate limit as proven blocked/impossible', () => {
    const msg = 'error: secondary rate limit exceeded for this token';
    expect(isSecondaryRateLimit(msg)).toBe(true);
    expect(isProvenBlockedOrImpossible(msg)).toBe(false);
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

  it('marks demo-confirm mutation dry-run as tested_inconclusive', async () => {
    const sink = await startMockSink();
    try {
      const tools = [tool('t-mut', 'mutate_remote_state', [Capability.MUTATE_REMOTE_STATE])];
      const planned = planDemoConfirmProfile([server()], new Map([['srv1', tools]]));
      const mutCase = planned.find((p) => p.caseDef.id === 'MUTATE_REMOTE_STATE_EXPOSED')!;

      const ctx = {
        collectionId: 'col1',
        profile: 'demo-confirm' as const,
        sink,
        invoke: async () => ({
          raw: null,
          text: JSON.stringify({ ok: true, dryRun: true }),
          isError: false,
        }),
      };

      const executed = await executePlannedTest(ctx, mutCase);
      expect(executed.testRun.outcome).toBe(TestOutcome.TESTED_INCONCLUSIVE);
      expect(executed.testRun.pathStatus).toBe(PathStatus.TESTED_INCONCLUSIVE);
    } finally {
      await sink.close();
    }
  });
});

describe('executeGithubSafeCanaryPlannedTest', () => {
  it('sanitizes branch names and creates the missing branch before retrying create_or_update_file', async () => {
    const githubSrv = { ...server(), name: 'github-mcp' };
    const githubTools = [tool('t3', 'create_or_update_file', [Capability.MUTATE_REPOSITORY])];
    const planned = planGithubSafeCanaryProfile([githubSrv], new Map([['srv1', githubTools]]));
    const repoMutationCase = planned.find(
      (p) => p.caseDef.id === 'GITHUB_REPOSITORY_MUTATION_CONTROLLED_ARTIFACT',
    );
    expect(repoMutationCase).toBeDefined();

    const sink = await startMockSink();
    try {
      const createCalls: Record<string, unknown>[] = [];
      const createBranchCalls: Record<string, unknown>[] = [];
      const ctx = {
        collectionId: 'col1',
        profile: 'github-safe-canary' as const,
        sink,
        invoke: async (_serverId: string, toolName: string, args: Record<string, unknown>) => {
          if (toolName === 'create_or_update_file') {
            createCalls.push(args);
            if (createCalls.length === 1) {
              return {
                raw: null,
                text: `MCP error -32603: Not Found: Resource not found: Branch ${String(args['branch'])} not found`,
                isError: true,
              };
            }
            return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
          }
          if (toolName === 'create_branch') {
            createBranchCalls.push(args);
            return { raw: null, text: JSON.stringify({ ref: args['branch'] }), isError: false };
          }
          if (toolName === 'get_file_contents') {
            // Mirrors github-mcp-server's actual `get_file_contents` response shape:
            // a plain-text status line concatenated with the file body encoded as base64.
            const encoded = Buffer.from('ISEEMP-testrun:ghsafe:mone3a91:onlkq0\n').toString(
              'base64',
            );
            return {
              raw: null,
              text: `successfully downloaded text file (SHA: deadbeef)${encoded}`,
              isError: false,
            };
          }
          return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
        },
      };

      const executed = await executeGithubSafeCanaryPlannedTest({
        ctx,
        planned: repoMutationCase!,
        testRunId: 'testrun:ghsafe:mone3a91:onlkq0',
        config: {
          owner: 'goldjg',
          repo: 'canary-sandbox',
          branchPrefix: 'iseemp-canary-',
          issuePrefix: 'ISEEMP-',
          canaryPrefix: 'ISEEMP',
        },
      });

      expect(createCalls).toHaveLength(2);
      expect(String(createCalls[0]?.['branch'])).not.toContain(':');
      // After branch-not-found, we must NOT retry without branch (the GitHub MCP
      // create_or_update_file schema requires `branch`); instead we create the branch first.
      expect(typeof createCalls[1]?.['branch']).toBe('string');
      expect(createCalls[1]?.['branch']).toBe(createCalls[0]?.['branch']);
      expect(createBranchCalls).toHaveLength(1);
      expect(createBranchCalls[0]?.['branch']).toBe(createCalls[0]?.['branch']);
      expect(executed.testRun.pathStatus).toBe(PathStatus.TESTED_CONFIRMED);
      expect(executed.testRun.notes).toContain('creating missing branch');
    } finally {
      await sink.close();
    }
  });

  it('handles thrown branch-not-found errors and still creates the missing branch before retrying', async () => {
    const githubSrv = { ...server(), name: 'github-mcp' };
    const githubTools = [tool('t3', 'create_or_update_file', [Capability.MUTATE_REPOSITORY])];
    const planned = planGithubSafeCanaryProfile([githubSrv], new Map([['srv1', githubTools]]));
    const repoMutationCase = planned.find(
      (p) => p.caseDef.id === 'GITHUB_REPOSITORY_MUTATION_CONTROLLED_ARTIFACT',
    );
    expect(repoMutationCase).toBeDefined();

    const sink = await startMockSink();
    try {
      let createCalls = 0;
      const ctx = {
        collectionId: 'col1',
        profile: 'github-safe-canary' as const,
        sink,
        invoke: async (_serverId: string, toolName: string) => {
          if (toolName === 'create_or_update_file') {
            createCalls += 1;
            if (createCalls === 1) {
              throw new Error(
                'MCP error -32603: Not Found: Resource not found: Branch iseemp-canary-branch not found',
              );
            }
            return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
          }
          if (toolName === 'get_file_contents') {
            return {
              raw: null,
              text: 'ISEEMP-testrun:ghsafe:monethrw:ab12cd',
              isError: false,
            };
          }
          return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
        },
      };

      const executed = await executeGithubSafeCanaryPlannedTest({
        ctx,
        planned: repoMutationCase!,
        testRunId: 'testrun:ghsafe:monethrw:ab12cd',
        config: {
          owner: 'goldjg',
          repo: 'canary-sandbox',
          branchPrefix: 'iseemp-canary-',
          issuePrefix: 'ISEEMP-',
          canaryPrefix: 'ISEEMP',
        },
      });

      expect(createCalls).toBe(2);
      expect(executed.testRun.pathStatus).toBe(PathStatus.TESTED_CONFIRMED);
      expect(executed.testRun.outcome).not.toBe(TestOutcome.TEST_ERROR);
    } finally {
      await sink.close();
    }
  });

  it('creates a missing branch and retries push_files without branchless fallback', async () => {
    const githubSrv = { ...server(), name: 'github-mcp' };
    const githubTools = [tool('t3', 'push_files', [Capability.MUTATE_REPOSITORY])];
    const planned = planGithubSafeCanaryProfile([githubSrv], new Map([['srv1', githubTools]]));
    const repoMutationCase = planned.find(
      (p) => p.caseDef.id === 'GITHUB_REPOSITORY_MUTATION_CONTROLLED_ARTIFACT',
    );
    expect(repoMutationCase).toBeDefined();

    const sink = await startMockSink();
    try {
      const pushCalls: Record<string, unknown>[] = [];
      const createBranchCalls: Record<string, unknown>[] = [];
      const ctx = {
        collectionId: 'col1',
        profile: 'github-safe-canary' as const,
        sink,
        invoke: async (_serverId: string, toolName: string, args: Record<string, unknown>) => {
          if (toolName === 'push_files') {
            pushCalls.push(args);
            if (pushCalls.length === 1) {
              return {
                raw: null,
                text: `MCP error -32603: Not Found: Resource not found: Branch ${String(args['branch'])} not found`,
                isError: true,
              };
            }
            return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
          }
          if (toolName === 'create_branch') {
            createBranchCalls.push(args);
            return {
              raw: null,
              text: JSON.stringify({ ok: true }),
              isError: false,
            };
          }
          if (toolName === 'get_file_contents') {
            return {
              raw: null,
              text: 'ISEEMP-testrun:ghsafe:pushf:abc123',
              isError: false,
            };
          }
          return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
        },
      };

      const executed = await executeGithubSafeCanaryPlannedTest({
        ctx,
        planned: repoMutationCase!,
        testRunId: 'testrun:ghsafe:pushf:abc123',
        config: {
          owner: 'goldjg',
          repo: 'canary-sandbox',
          branchPrefix: 'iseemp-canary-',
          issuePrefix: 'ISEEMP-',
          canaryPrefix: 'ISEEMP',
        },
      });

      expect(pushCalls).toHaveLength(2);
      expect(createBranchCalls).toHaveLength(1);
      expect(typeof pushCalls[0]?.['branch']).toBe('string');
      expect((pushCalls[0]?.['branch'] as string).trim().length).toBeGreaterThan(0);
      expect(createBranchCalls[0]?.['branch']).toBe(pushCalls[0]?.['branch']);
      expect(executed.testRun.pathStatus).toBe(PathStatus.TESTED_CONFIRMED);
      expect(executed.testRun.notes).toContain('Canary observed');
    } finally {
      await sink.close();
    }
  });

  it('confirms repo mutation when file readback returns base64 content payload', async () => {
    const githubSrv = { ...server(), name: 'github-mcp' };
    const githubTools = [tool('t3', 'create_or_update_file', [Capability.MUTATE_REPOSITORY])];
    const planned = planGithubSafeCanaryProfile([githubSrv], new Map([['srv1', githubTools]]));
    const repoMutationCase = planned.find(
      (p) => p.caseDef.id === 'GITHUB_REPOSITORY_MUTATION_CONTROLLED_ARTIFACT',
    );
    expect(repoMutationCase).toBeDefined();

    const runId = 'testrun:ghsafe:mono1234:abcd12';
    const marker = `ISEEMP-${runId}`;
    const sink = await startMockSink();
    try {
      const ctx = {
        collectionId: 'col1',
        profile: 'github-safe-canary' as const,
        sink,
        invoke: async (_serverId: string, toolName: string) => {
          if (toolName === 'create_or_update_file') {
            return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
          }
          if (toolName === 'get_file_contents') {
            return {
              raw: null,
              text: JSON.stringify({
                encoding: 'base64',
                content: Buffer.from(`${marker}\n`, 'utf8').toString('base64'),
              }),
              isError: false,
            };
          }
          return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
        },
      };

      const executed = await executeGithubSafeCanaryPlannedTest({
        ctx,
        planned: repoMutationCase!,
        testRunId: runId,
        config: {
          owner: 'goldjg',
          repo: 'canary-sandbox',
          branchPrefix: 'iseemp-canary-',
          issuePrefix: 'ISEEMP-',
          canaryPrefix: 'ISEEMP',
        },
      });

      expect(executed.testRun.pathStatus).toBe(PathStatus.TESTED_CONFIRMED);
    } finally {
      await sink.close();
    }
  });

  it('retries controlled file readback for repo mutation before concluding', async () => {
    vi.useFakeTimers();
    const githubSrv = { ...server(), name: 'github-mcp' };
    const githubTools = [tool('t3', 'create_or_update_file', [Capability.MUTATE_REPOSITORY])];
    const planned = planGithubSafeCanaryProfile([githubSrv], new Map([['srv1', githubTools]]));
    const repoMutationCase = planned.find(
      (p) => p.caseDef.id === 'GITHUB_REPOSITORY_MUTATION_CONTROLLED_ARTIFACT',
    );
    expect(repoMutationCase).toBeDefined();

    const runId = 'testrun:ghsafe:reporetry:abcd12';
    const marker = `ISEEMP-${runId}`;
    const sink = await startMockSink();
    try {
      const toolCalls: string[] = [];
      let fileReads = 0;
      const ctx = {
        collectionId: 'col1',
        profile: 'github-safe-canary' as const,
        sink,
        invoke: async (_serverId: string, toolName: string) => {
          toolCalls.push(toolName);
          if (toolName === 'create_or_update_file') {
            return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
          }
          if (toolName === 'get_file_contents') {
            fileReads += 1;
            return fileReads <= 2
              ? { raw: null, text: JSON.stringify({ body: 'controlled\nmissing' }), isError: false }
              : {
                  raw: null,
                  text: JSON.stringify({
                    encoding: 'base64',
                    content: Buffer.from(`${marker}\n`, 'utf8').toString('base64'),
                  }),
                  isError: false,
                };
          }
          return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
        },
      };

      const execution = executeGithubSafeCanaryPlannedTest({
        ctx,
        planned: repoMutationCase!,
        testRunId: runId,
        config: {
          owner: 'goldjg',
          repo: 'canary-sandbox',
          branchPrefix: 'iseemp-canary-',
          issuePrefix: 'ISEEMP-',
          canaryPrefix: 'ISEEMP',
        },
      });
      await vi.runAllTimersAsync();
      const executed = await execution;

      expect(toolCalls.filter((name) => name === 'get_file_contents')).toHaveLength(3);
      expect(executed.testRun.pathStatus).toBe(PathStatus.TESTED_CONFIRMED);
      expect(executed.testRun.canaryObserved).toBe(true);
    } finally {
      vi.useRealTimers();
      await sink.close();
    }
  });

  it('sends sha on repository write when pre-write probe returns existing file metadata', async () => {
    const githubSrv = { ...server(), name: 'github-mcp' };
    const githubTools = [tool('t3', 'create_or_update_file', [Capability.MUTATE_REPOSITORY])];
    const planned = planGithubSafeCanaryProfile([githubSrv], new Map([['srv1', githubTools]]));
    const repoMutationCase = planned.find(
      (p) => p.caseDef.id === 'GITHUB_REPOSITORY_MUTATION_CONTROLLED_ARTIFACT',
    );
    expect(repoMutationCase).toBeDefined();

    const runId = 'testrun:ghsafe:shaexists:abcd99';
    const marker = `ISEEMP-${runId}`;
    const sink = await startMockSink();
    try {
      const writeCalls: Array<Record<string, unknown>> = [];
      const ctx = {
        collectionId: 'col1',
        profile: 'github-safe-canary' as const,
        sink,
        invoke: async (_serverId: string, toolName: string, args: Record<string, unknown>) => {
          if (toolName === 'get_file_contents') {
            return {
              raw: null,
              text: JSON.stringify({
                sha: 'abc123def456',
                encoding: 'base64',
                content: Buffer.from(`${marker}\n`, 'utf8').toString('base64'),
              }),
              isError: false,
            };
          }
          if (toolName === 'create_or_update_file') {
            writeCalls.push(args);
            return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
          }
          return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
        },
      };

      const executed = await executeGithubSafeCanaryPlannedTest({
        ctx,
        planned: repoMutationCase!,
        testRunId: runId,
        config: {
          owner: 'goldjg',
          repo: 'canary-sandbox',
          branchPrefix: 'iseemp-canary-',
          issuePrefix: 'ISEEMP-',
          canaryPrefix: 'ISEEMP',
        },
      });

      expect(writeCalls).toHaveLength(1);
      expect(writeCalls[0]?.['sha']).toBe('abc123def456');
      expect(executed.testRun.pathStatus).toBe(PathStatus.TESTED_CONFIRMED);
    } finally {
      await sink.close();
    }
  });

  it('continues without sha when pre-write probe returns file-not-found', async () => {
    const githubSrv = { ...server(), name: 'github-mcp' };
    const githubTools = [tool('t3', 'create_or_update_file', [Capability.MUTATE_REPOSITORY])];
    const planned = planGithubSafeCanaryProfile([githubSrv], new Map([['srv1', githubTools]]));
    const repoMutationCase = planned.find(
      (p) => p.caseDef.id === 'GITHUB_REPOSITORY_MUTATION_CONTROLLED_ARTIFACT',
    );
    expect(repoMutationCase).toBeDefined();

    const runId = 'testrun:ghsafe:nosha:abcd88';
    const marker = `ISEEMP-${runId}`;
    const sink = await startMockSink();
    try {
      const writeCalls: Array<Record<string, unknown>> = [];
      let reads = 0;
      const ctx = {
        collectionId: 'col1',
        profile: 'github-safe-canary' as const,
        sink,
        invoke: async (_serverId: string, toolName: string, args: Record<string, unknown>) => {
          if (toolName === 'get_file_contents') {
            reads += 1;
            if (reads === 1) {
              return {
                raw: null,
                text: '404 Not Found: path does not point to a file',
                isError: true,
              };
            }
            return {
              raw: null,
              text: JSON.stringify({
                encoding: 'base64',
                content: Buffer.from(`${marker}\n`, 'utf8').toString('base64'),
              }),
              isError: false,
            };
          }
          if (toolName === 'create_or_update_file') {
            writeCalls.push(args);
            return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
          }
          return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
        },
      };

      const executed = await executeGithubSafeCanaryPlannedTest({
        ctx,
        planned: repoMutationCase!,
        testRunId: runId,
        config: {
          owner: 'goldjg',
          repo: 'canary-sandbox',
          branchPrefix: 'iseemp-canary-',
          issuePrefix: 'ISEEMP-',
          canaryPrefix: 'ISEEMP',
        },
      });

      expect(writeCalls).toHaveLength(1);
      expect(writeCalls[0]?.['sha']).toBeUndefined();
      expect(executed.testRun.pathStatus).toBe(PathStatus.TESTED_CONFIRMED);
    } finally {
      await sink.close();
    }
  });

  it('marks inconclusive and does not write when pre-write probe returns permission error', async () => {
    const githubSrv = { ...server(), name: 'github-mcp' };
    const githubTools = [tool('t3', 'create_or_update_file', [Capability.MUTATE_REPOSITORY])];
    const planned = planGithubSafeCanaryProfile([githubSrv], new Map([['srv1', githubTools]]));
    const repoMutationCase = planned.find(
      (p) => p.caseDef.id === 'GITHUB_REPOSITORY_MUTATION_CONTROLLED_ARTIFACT',
    );
    expect(repoMutationCase).toBeDefined();

    const sink = await startMockSink();
    try {
      let wrote = false;
      const ctx = {
        collectionId: 'col1',
        profile: 'github-safe-canary' as const,
        sink,
        invoke: async (_serverId: string, toolName: string) => {
          if (toolName === 'get_file_contents') {
            return {
              raw: null,
              text: '403 Forbidden: resource not accessible by integration',
              isError: true,
            };
          }
          if (toolName === 'create_or_update_file') {
            wrote = true;
          }
          return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
        },
      };

      const executed = await executeGithubSafeCanaryPlannedTest({
        ctx,
        planned: repoMutationCase!,
        testRunId: 'testrun:ghsafe:permerr:abcd11',
        config: {
          owner: 'goldjg',
          repo: 'canary-sandbox',
          branchPrefix: 'iseemp-canary-',
          issuePrefix: 'ISEEMP-',
          canaryPrefix: 'ISEEMP',
        },
      });

      expect(wrote).toBe(false);
      expect(executed.testRun.pathStatus).toBe(PathStatus.TESTED_INCONCLUSIVE);
      expect(executed.testRun.notes).toContain('lacked permissions');
    } finally {
      await sink.close();
    }
  });

  it('marks repository writes as inconclusive on secondary rate limit', async () => {
    const githubSrv = { ...server(), name: 'github-mcp' };
    const githubTools = [tool('t3', 'create_or_update_file', [Capability.MUTATE_REPOSITORY])];
    const planned = planGithubSafeCanaryProfile([githubSrv], new Map([['srv1', githubTools]]));
    const repoMutationCase = planned.find(
      (p) => p.caseDef.id === 'GITHUB_REPOSITORY_MUTATION_CONTROLLED_ARTIFACT',
    );
    expect(repoMutationCase).toBeDefined();

    const sink = await startMockSink();
    try {
      let reads = 0;
      const ctx = {
        collectionId: 'col1',
        profile: 'github-safe-canary' as const,
        sink,
        invoke: async (_serverId: string, toolName: string) => {
          if (toolName === 'get_file_contents') {
            reads += 1;
            if (reads === 1) return { raw: null, text: '404 Not Found', isError: true };
            return { raw: null, text: 'secondary rate limit exceeded', isError: true };
          }
          if (toolName === 'create_or_update_file') {
            return { raw: null, text: 'secondary rate limit exceeded', isError: true };
          }
          return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
        },
      };

      const executed = await executeGithubSafeCanaryPlannedTest({
        ctx,
        planned: repoMutationCase!,
        testRunId: 'testrun:ghsafe:ratelimit:abcd22',
        config: {
          owner: 'goldjg',
          repo: 'canary-sandbox',
          branchPrefix: 'iseemp-canary-',
          issuePrefix: 'ISEEMP-',
          canaryPrefix: 'ISEEMP',
        },
      });

      expect(executed.testRun.pathStatus).toBe(PathStatus.TESTED_INCONCLUSIVE);
      expect(executed.testRun.notes).toContain('rate-limited');
    } finally {
      await sink.close();
    }
  });

  it('marks repository writes as rejected when blocked by integration permissions', async () => {
    const githubSrv = { ...server(), name: 'github-mcp' };
    const githubTools = [tool('t3', 'create_or_update_file', [Capability.MUTATE_REPOSITORY])];
    const planned = planGithubSafeCanaryProfile([githubSrv], new Map([['srv1', githubTools]]));
    const repoMutationCase = planned.find(
      (p) => p.caseDef.id === 'GITHUB_REPOSITORY_MUTATION_CONTROLLED_ARTIFACT',
    );
    expect(repoMutationCase).toBeDefined();

    const sink = await startMockSink();
    try {
      const ctx = {
        collectionId: 'col1',
        profile: 'github-safe-canary' as const,
        sink,
        invoke: async (_serverId: string, toolName: string) => {
          if (toolName === 'get_file_contents') return { raw: null, text: '404 Not Found', isError: true };
          if (toolName === 'create_or_update_file') {
            return {
              raw: null,
              text: '403 Forbidden: resource not accessible by integration',
              isError: true,
            };
          }
          return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
        },
      };

      const executed = await executeGithubSafeCanaryPlannedTest({
        ctx,
        planned: repoMutationCase!,
        testRunId: 'testrun:ghsafe:blocked:abcd33',
        config: {
          owner: 'goldjg',
          repo: 'canary-sandbox',
          branchPrefix: 'iseemp-canary-',
          issuePrefix: 'ISEEMP-',
          canaryPrefix: 'ISEEMP',
        },
      });

      expect(executed.testRun.pathStatus).toBe(PathStatus.TESTED_REJECTED);
      expect(executed.testRun.notes).toContain('blocked');
    } finally {
      await sink.close();
    }
  });

  it('confirms issue-write case by reading issue body when write response omits marker', async () => {
    const githubSrv = { ...server(), name: 'github-mcp' };
    const githubTools = [tool('t2', 'issue_write', [Capability.MUTATE_ISSUE_OR_PR])];
    const planned = planGithubSafeCanaryProfile([githubSrv], new Map([['srv1', githubTools]]));
    const issueCase = planned.find(
      (p) => p.caseDef.id === 'GITHUB_ISSUE_PR_WRITE_CONTROLLED_ARTIFACT',
    );
    expect(issueCase).toBeDefined();

    const runId = 'testrun:ghsafe:mono1234:efgh56';
    const marker = `ISEEMP-${runId}`;
    const sink = await startMockSink();
    try {
      const toolCalls: string[] = [];
      const callArgs: Array<Record<string, unknown>> = [];
      const ctx = {
        collectionId: 'col1',
        profile: 'github-safe-canary' as const,
        sink,
        invoke: async (_serverId: string, toolName: string, args: Record<string, unknown>) => {
          toolCalls.push(toolName);
          callArgs.push(args);
          if (toolName === 'issue_write') {
            return {
              raw: null,
              text: JSON.stringify({ number: 123, html_url: 'https://github.com/goldjg/canary-sandbox/issues/123' }),
              isError: false,
            };
          }
          if (toolName === 'issue_read') {
            return {
              raw: null,
              text: JSON.stringify({ body: `controlled\n${marker}` }),
              isError: false,
            };
          }
          return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
        },
      };

      const executed = await executeGithubSafeCanaryPlannedTest({
        ctx,
        planned: issueCase!,
        testRunId: runId,
        config: {
          owner: 'goldjg',
          repo: 'canary-sandbox',
          branchPrefix: 'iseemp-canary-',
          issuePrefix: 'ISEEMP-',
          canaryPrefix: 'ISEEMP',
        },
      });

      expect(callArgs[0]?.['method']).toBe('create');
      expect(toolCalls).toContain('issue_read');
      expect(executed.testRun.pathStatus).toBe(PathStatus.TESTED_CONFIRMED);
    } finally {
      await sink.close();
    }
  });

  it('marks issue/pr writes as inconclusive on secondary rate limit', async () => {
    const githubSrv = { ...server(), name: 'github-mcp' };
    const githubTools = [tool('t2', 'issue_write', [Capability.MUTATE_ISSUE_OR_PR])];
    const planned = planGithubSafeCanaryProfile([githubSrv], new Map([['srv1', githubTools]]));
    const issueCase = planned.find(
      (p) => p.caseDef.id === 'GITHUB_ISSUE_PR_WRITE_CONTROLLED_ARTIFACT',
    );
    expect(issueCase).toBeDefined();

    const sink = await startMockSink();
    try {
      const ctx = {
        collectionId: 'col1',
        profile: 'github-safe-canary' as const,
        sink,
        invoke: async () => ({
          raw: null,
          text: 'secondary rate limit exceeded',
          isError: true,
        }),
      };

      const executed = await executeGithubSafeCanaryPlannedTest({
        ctx,
        planned: issueCase!,
        testRunId: 'testrun:ghsafe:issuerl:abcd44',
        config: {
          owner: 'goldjg',
          repo: 'canary-sandbox',
          branchPrefix: 'iseemp-canary-',
          issuePrefix: 'ISEEMP-',
          canaryPrefix: 'ISEEMP',
        },
      });

      expect(executed.testRun.pathStatus).toBe(PathStatus.TESTED_INCONCLUSIVE);
      expect(executed.testRun.notes).toContain('rate-limited');
    } finally {
      await sink.close();
    }
  });

  it('extracts issue number from URL when issue_write response omits number field', async () => {
    const githubSrv = { ...server(), name: 'github-mcp' };
    const githubTools = [tool('t2', 'issue_write', [Capability.MUTATE_ISSUE_OR_PR])];
    const planned = planGithubSafeCanaryProfile([githubSrv], new Map([['srv1', githubTools]]));
    const issueCase = planned.find(
      (p) => p.caseDef.id === 'GITHUB_ISSUE_PR_WRITE_CONTROLLED_ARTIFACT',
    );
    expect(issueCase).toBeDefined();

    const runId = 'testrun:ghsafe:issueurlonly:efgh56';
    const marker = `ISEEMP-${runId}`;
    const sink = await startMockSink();
    try {
      const issueReadInputs: Array<Record<string, unknown>> = [];
      const ctx = {
        collectionId: 'col1',
        profile: 'github-safe-canary' as const,
        sink,
        invoke: async (_serverId: string, toolName: string, args: Record<string, unknown>) => {
          if (toolName === 'issue_write') {
            return {
              raw: null,
              text: JSON.stringify({
                id: '4370027799',
                url: 'https://github.com/goldjg/canary-sandbox/issues/26',
              }),
              isError: false,
            };
          }
          if (toolName === 'issue_read') {
            issueReadInputs.push(args);
            return {
              raw: null,
              text: JSON.stringify({ body: `controlled\n${marker}` }),
              isError: false,
            };
          }
          return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
        },
      };

      const executed = await executeGithubSafeCanaryPlannedTest({
        ctx,
        planned: issueCase!,
        testRunId: runId,
        config: {
          owner: 'goldjg',
          repo: 'canary-sandbox',
          branchPrefix: 'iseemp-canary-',
          issuePrefix: 'ISEEMP-',
          canaryPrefix: 'ISEEMP',
        },
      });

      expect(issueReadInputs).toHaveLength(1);
      expect(issueReadInputs[0]?.['issue_number']).toBe(26);
      expect(executed.testRun.pathStatus).toBe(PathStatus.TESTED_CONFIRMED);
      expect(executed.testRun.canaryObserved).toBe(true);
    } finally {
      await sink.close();
    }
  });

  it('retries issue readback once before concluding the controlled issue canary is missing', async () => {
    vi.useFakeTimers();
    const githubSrv = { ...server(), name: 'github-mcp' };
    const githubTools = [tool('t2', 'issue_write', [Capability.MUTATE_ISSUE_OR_PR])];
    const planned = planGithubSafeCanaryProfile([githubSrv], new Map([['srv1', githubTools]]));
    const issueCase = planned.find(
      (p) => p.caseDef.id === 'GITHUB_ISSUE_PR_WRITE_CONTROLLED_ARTIFACT',
    );
    expect(issueCase).toBeDefined();

    const runId = 'testrun:ghsafe:issueretry:efgh56';
    const marker = `ISEEMP-${runId}`;
    const sink = await startMockSink();
    try {
      const toolCalls: string[] = [];
      let issueReads = 0;
      const ctx = {
        collectionId: 'col1',
        profile: 'github-safe-canary' as const,
        sink,
        invoke: async (_serverId: string, toolName: string) => {
          toolCalls.push(toolName);
          if (toolName === 'issue_write') {
            return {
              raw: null,
              text: JSON.stringify({ number: 123, html_url: 'https://github.com/goldjg/canary-sandbox/issues/123' }),
              isError: false,
            };
          }
          if (toolName === 'issue_read') {
            issueReads += 1;
            return issueReads === 1
              ? { raw: null, text: JSON.stringify({ body: 'controlled\nmissing' }), isError: false }
              : { raw: null, text: JSON.stringify({ body: `controlled\n${marker}` }), isError: false };
          }
          return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
        },
      };

      const execution = executeGithubSafeCanaryPlannedTest({
        ctx,
        planned: issueCase!,
        testRunId: runId,
        config: {
          owner: 'goldjg',
          repo: 'canary-sandbox',
          branchPrefix: 'iseemp-canary-',
          issuePrefix: 'ISEEMP-',
          canaryPrefix: 'ISEEMP',
        },
      });
      await vi.runAllTimersAsync();
      const executed = await execution;

      expect(toolCalls.filter((name) => name === 'issue_read')).toHaveLength(2);
      expect(executed.testRun.pathStatus).toBe(PathStatus.TESTED_CONFIRMED);
    } finally {
      vi.useRealTimers();
      await sink.close();
    }
  });

  it('passes branch/ref to get_file_contents when reading the controlled canary file', async () => {
    const githubSrv = { ...server(), name: 'github-mcp' };
    const githubTools = [tool('t-read', 'get_file_contents', [Capability.READ_REMOTE_DATA])];
    const planned = planGithubSafeCanaryProfile([githubSrv], new Map([['srv1', githubTools]]));
    const readCase = planned.find((p) => p.caseDef.id === 'GITHUB_READ_CONTROLLED_ARTIFACT');
    expect(readCase).toBeDefined();

    const runId = 'testrun:ghsafe:readref:ab12cd';
    const marker = `ISEEMP-${runId}`;
    const sink = await startMockSink();
    try {
      const getFileCalls: Array<Record<string, unknown>> = [];
      const ctx = {
        collectionId: 'col1',
        profile: 'github-safe-canary' as const,
        sink,
        invoke: async (_serverId: string, toolName: string, args: Record<string, unknown>) => {
          if (toolName === 'create_or_update_file') {
            return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
          }
          if (toolName === 'get_file_contents') {
            getFileCalls.push(args);
            return {
              raw: null,
              text: JSON.stringify({
                encoding: 'base64',
                content: Buffer.from(`${marker}\n`, 'utf8').toString('base64'),
              }),
              isError: false,
            };
          }
          return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
        },
      };

      const executed = await executeGithubSafeCanaryPlannedTest({
        ctx,
        planned: readCase!,
        testRunId: runId,
        config: {
          owner: 'goldjg',
          repo: 'canary-sandbox',
          branchPrefix: 'iseemp-canary-',
          issuePrefix: 'ISEEMP-',
          canaryPrefix: 'ISEEMP',
        },
      });

      expect(getFileCalls).toHaveLength(1);
      expect(getFileCalls[0]?.['ref']).toBeDefined();
      expect(getFileCalls[0]?.['branch']).toBe(getFileCalls[0]?.['ref']);
      expect(executed.testRun.pathStatus).toBe(PathStatus.TESTED_CONFIRMED);
    } finally {
      await sink.close();
    }
  });

  it('falls back to controlled get_file_contents readback when the primary read tool errors', async () => {
    const githubSrv = { ...server(), name: 'github-mcp' };
    const githubTools = [tool('t-read', 'search_code', [Capability.READ_REMOTE_DATA])];
    const planned = planGithubSafeCanaryProfile([githubSrv], new Map([['srv1', githubTools]]));
    const readCase = planned.find((p) => p.caseDef.id === 'GITHUB_READ_CONTROLLED_ARTIFACT');
    expect(readCase).toBeDefined();

    const runId = 'testrun:ghsafe:readfb:zz99yy';
    const marker = `ISEEMP-${runId}`;
    const sink = await startMockSink();
    try {
      const toolCalls: string[] = [];
      const ctx = {
        collectionId: 'col1',
        profile: 'github-safe-canary' as const,
        sink,
        invoke: async (_serverId: string, toolName: string) => {
          toolCalls.push(toolName);
          if (toolName === 'create_or_update_file') {
            return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
          }
          if (toolName === 'search_code') {
            return {
              raw: null,
              text: '404 Not Found: controlled file is not on the default branch',
              isError: true,
            };
          }
          if (toolName === 'get_file_contents') {
            return {
              raw: null,
              text: JSON.stringify({
                encoding: 'base64',
                content: Buffer.from(`${marker}\n`, 'utf8').toString('base64'),
              }),
              isError: false,
            };
          }
          return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
        },
      };

      const executed = await executeGithubSafeCanaryPlannedTest({
        ctx,
        planned: readCase!,
        testRunId: runId,
        config: {
          owner: 'goldjg',
          repo: 'canary-sandbox',
          branchPrefix: 'iseemp-canary-',
          issuePrefix: 'ISEEMP-',
          canaryPrefix: 'ISEEMP',
        },
      });

      expect(toolCalls.slice(0, 3)).toEqual(['create_or_update_file', 'search_code', 'get_file_contents']);
      expect(executed.testRun.pathStatus).toBe(PathStatus.TESTED_CONFIRMED);
      expect(executed.testRun.notes).toContain('primary read tool failed');
    } finally {
      await sink.close();
    }
  });

  it('falls back to controlled get_file_contents when primary read tool rejects generic probe input', async () => {
    const githubSrv = { ...server(), name: 'github-mcp' };
    const githubTools = [tool('t-read', 'get_code_scanning_alert', [Capability.READ_REMOTE_DATA])];
    const planned = planGithubSafeCanaryProfile([githubSrv], new Map([['srv1', githubTools]]));
    const readCase = planned.find((p) => p.caseDef.id === 'GITHUB_READ_CONTROLLED_ARTIFACT');
    expect(readCase).toBeDefined();

    const runId = 'testrun:ghsafe:readshape:ll22kk';
    const marker = `ISEEMP-${runId}`;
    const sink = await startMockSink();
    try {
      const toolCalls: string[] = [];
      const ctx = {
        collectionId: 'col1',
        profile: 'github-safe-canary' as const,
        sink,
        invoke: async (_serverId: string, toolName: string) => {
          toolCalls.push(toolName);
          if (toolName === 'create_or_update_file') {
            return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
          }
          if (toolName === 'get_code_scanning_alert') {
            return {
              raw: null,
              text: 'error: missing required parameter: alertNumber',
              isError: true,
            };
          }
          if (toolName === 'get_file_contents') {
            return {
              raw: null,
              text: JSON.stringify({
                encoding: 'base64',
                content: Buffer.from(`${marker}\n`, 'utf8').toString('base64'),
              }),
              isError: false,
            };
          }
          return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
        },
      };

      const executed = await executeGithubSafeCanaryPlannedTest({
        ctx,
        planned: readCase!,
        testRunId: runId,
        config: {
          owner: 'goldjg',
          repo: 'canary-sandbox',
          branchPrefix: 'iseemp-canary-',
          issuePrefix: 'ISEEMP-',
          canaryPrefix: 'ISEEMP',
        },
      });

      expect(toolCalls.slice(0, 3)).toEqual(['create_or_update_file', 'get_code_scanning_alert', 'get_file_contents']);
      expect(executed.testRun.pathStatus).toBe(PathStatus.TESTED_CONFIRMED);
      expect(executed.testRun.notes).toContain('primary read tool failed');
    } finally {
      await sink.close();
    }
  });

  it('confirms canary when controlled readback includes marker even if response is flagged as error', async () => {
    const githubSrv = { ...server(), name: 'github-mcp' };
    const githubTools = [tool('t-read', 'search_code', [Capability.READ_REMOTE_DATA])];
    const planned = planGithubSafeCanaryProfile([githubSrv], new Map([['srv1', githubTools]]));
    const readCase = planned.find((p) => p.caseDef.id === 'GITHUB_READ_CONTROLLED_ARTIFACT');
    expect(readCase).toBeDefined();

    const runId = 'testrun:ghsafe:readerrorflag:mm44nn';
    const marker = `ISEEMP-${runId}`;
    const sink = await startMockSink();
    try {
      const toolCalls: string[] = [];
      const ctx = {
        collectionId: 'col1',
        profile: 'github-safe-canary' as const,
        sink,
        invoke: async (_serverId: string, toolName: string) => {
          toolCalls.push(toolName);
          if (toolName === 'create_or_update_file') {
            return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
          }
          if (toolName === 'search_code') {
            return {
              raw: null,
              text: 'error: query parameter unsupported',
              isError: true,
            };
          }
          if (toolName === 'get_file_contents') {
            return {
              raw: null,
              text: JSON.stringify({
                encoding: 'base64',
                content: Buffer.from(`${marker}\n`, 'utf8').toString('base64'),
              }),
              isError: true,
            };
          }
          return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
        },
      };

      const executed = await executeGithubSafeCanaryPlannedTest({
        ctx,
        planned: readCase!,
        testRunId: runId,
        config: {
          owner: 'goldjg',
          repo: 'canary-sandbox',
          branchPrefix: 'iseemp-canary-',
          issuePrefix: 'ISEEMP-',
          canaryPrefix: 'ISEEMP',
        },
      });

      expect(toolCalls.slice(0, 3)).toEqual(['create_or_update_file', 'search_code', 'get_file_contents']);
      expect(executed.testRun.pathStatus).toBe(PathStatus.TESTED_CONFIRMED);
      expect(executed.testRun.canaryObserved).toBe(true);
    } finally {
      await sink.close();
    }
  });

  it('confirms canary when controlled readback includes marker and response is not flagged as error', async () => {
    const githubSrv = { ...server(), name: 'github-mcp' };
    const githubTools = [tool('t-read', 'search_code', [Capability.READ_REMOTE_DATA])];
    const planned = planGithubSafeCanaryProfile([githubSrv], new Map([['srv1', githubTools]]));
    const readCase = planned.find((p) => p.caseDef.id === 'GITHUB_READ_CONTROLLED_ARTIFACT');
    expect(readCase).toBeDefined();

    const runId = 'testrun:ghsafe:readokflag:pp66qq';
    const marker = `ISEEMP-${runId}`;
    const sink = await startMockSink();
    try {
      const toolCalls: string[] = [];
      const ctx = {
        collectionId: 'col1',
        profile: 'github-safe-canary' as const,
        sink,
        invoke: async (_serverId: string, toolName: string) => {
          toolCalls.push(toolName);
          if (toolName === 'create_or_update_file') {
            return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
          }
          if (toolName === 'search_code') {
            return {
              raw: null,
              text: 'error: query parameter unsupported',
              isError: true,
            };
          }
          if (toolName === 'get_file_contents') {
            return {
              raw: null,
              text: JSON.stringify({
                encoding: 'base64',
                content: Buffer.from(`${marker}\n`, 'utf8').toString('base64'),
              }),
              isError: false,
            };
          }
          return { raw: null, text: JSON.stringify({ ok: true }), isError: false };
        },
      };

      const executed = await executeGithubSafeCanaryPlannedTest({
        ctx,
        planned: readCase!,
        testRunId: runId,
        config: {
          owner: 'goldjg',
          repo: 'canary-sandbox',
          branchPrefix: 'iseemp-canary-',
          issuePrefix: 'ISEEMP-',
          canaryPrefix: 'ISEEMP',
        },
      });

      expect(toolCalls.slice(0, 3)).toEqual(['create_or_update_file', 'search_code', 'get_file_contents']);
      expect(executed.testRun.pathStatus).toBe(PathStatus.TESTED_CONFIRMED);
      expect(executed.testRun.canaryObserved).toBe(true);
      expect(executed.testRun.notes).toContain('primary read tool failed');
    } finally {
      await sink.close();
    }
  });
});
