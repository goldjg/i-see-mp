import { describe, it, expect } from 'vitest';
import { runFindingsRules } from '../findings-rules.js';
import { Capability, RiskCategory } from '@iseemp/core';

const now = new Date().toISOString();

function makeServer(id: string, url: string | null = null) {
  return {
    id,
    collection_id: 'col1',
    name: `server-${id}`,
    url,
    command: url ? null : 'node',
    args: null,
    env: null,
    transport: url ? 'sse' : 'stdio',
    is_verified: 0,
    created_at: now,
  };
}

function makeTool(id: string, serverId: string, caps: Capability[]) {
  return {
    id,
    collection_id: 'col1',
    server_id: serverId,
    name: `tool-${id}`,
    description: null,
    input_schema: null,
    capabilities: JSON.stringify(caps),
    risk_score: 50,
    created_at: now,
  };
}

describe('runFindingsRules — UNVERIFIED_SERVER', () => {
  it('fires for every server', () => {
    const server = makeServer('srv1');
    const findings = runFindingsRules({ nodes: [], edges: [], servers: [server], tools: [], collectionId: 'col1' });
    expect(findings.some((f) => f.category === RiskCategory.UNVERIFIED_SERVER)).toBe(true);
  });

  it('is LOW severity for an unverified server with only low-impact tools', () => {
    const server = makeServer('srv1');
    const tool = makeTool('t1', 'srv1', [Capability.QUERY_REMOTE_SYSTEM, Capability.READ_REMOTE_DATA]);
    const findings = runFindingsRules({ nodes: [], edges: [], servers: [server], tools: [tool], collectionId: 'col1' });
    const f = findings.find((x) => x.category === RiskCategory.UNVERIFIED_SERVER);
    expect(f?.severity).toBe('low');
  });
});

describe('runFindingsRules — TRUST_BOUNDARY_CROSSING', () => {
  it('fires for remote server URL', () => {
    const server = makeServer('srv1', 'https://api.example.com/mcp');
    const findings = runFindingsRules({ nodes: [], edges: [], servers: [server], tools: [], collectionId: 'col1' });
    expect(findings.some((f) => f.category === RiskCategory.TRUST_BOUNDARY_CROSSING)).toBe(true);
  });

  it('does NOT fire for localhost server', () => {
    const server = makeServer('srv1', 'http://localhost:3000/mcp');
    const findings = runFindingsRules({ nodes: [], edges: [], servers: [server], tools: [], collectionId: 'col1' });
    expect(findings.some((f) => f.category === RiskCategory.TRUST_BOUNDARY_CROSSING)).toBe(false);
  });
});

describe('runFindingsRules — CODE_EXECUTION', () => {
  it('fires for RUN_SHELL tool with high severity (no chain)', () => {
    const server = makeServer('srv1');
    const tool = makeTool('t1', 'srv1', [Capability.RUN_SHELL]);
    const findings = runFindingsRules({ nodes: [], edges: [], servers: [server], tools: [tool], collectionId: 'col1' });
    const f = findings.find((x) => x.category === RiskCategory.CODE_EXECUTION);
    expect(f).toBeDefined();
    expect(['high', 'critical']).toContain(f?.severity);
  });

  it('fires for EXECUTE_CODE tool with high/critical severity', () => {
    const server = makeServer('srv1');
    const tool = makeTool('t1', 'srv1', [Capability.EXECUTE_CODE]);
    const findings = runFindingsRules({ nodes: [], edges: [], servers: [server], tools: [tool], collectionId: 'col1' });
    const f = findings.find((x) => x.category === RiskCategory.CODE_EXECUTION);
    expect(f).toBeDefined();
    expect(['high', 'critical']).toContain(f?.severity);
  });

  it('does NOT fire for plain QUERY_REMOTE_SYSTEM tool', () => {
    const server = makeServer('srv1');
    const tool = makeTool('t1', 'srv1', [Capability.QUERY_REMOTE_SYSTEM]);
    const findings = runFindingsRules({ nodes: [], edges: [], servers: [server], tools: [tool], collectionId: 'col1' });
    expect(findings.some((f) => f.category === RiskCategory.CODE_EXECUTION)).toBe(false);
  });

  it('does NOT fire for MUTATE_ISSUE_OR_PR tool', () => {
    const server = makeServer('srv1');
    const tool = makeTool('t1', 'srv1', [Capability.MUTATE_ISSUE_OR_PR, Capability.MUTATE_REMOTE_STATE]);
    const findings = runFindingsRules({ nodes: [], edges: [], servers: [server], tools: [tool], collectionId: 'col1' });
    expect(findings.some((f) => f.category === RiskCategory.CODE_EXECUTION)).toBe(false);
  });
});

describe('runFindingsRules — SENSITIVE_DATA_EXPOSURE (sensitivity tiers)', () => {
  it('fires HIGH for READ_SECRET_HIGH tool', () => {
    const server = makeServer('srv1');
    const tool = makeTool('t1', 'srv1', [Capability.READ_SECRET_HIGH]);
    const findings = runFindingsRules({ nodes: [], edges: [], servers: [server], tools: [tool], collectionId: 'col1' });
    const f = findings.find((x) => x.category === RiskCategory.SENSITIVE_DATA_EXPOSURE);
    expect(f?.severity).toBe('high');
  });

  it('fires HIGH for legacy READ_SECRET tool', () => {
    const server = makeServer('srv1');
    const tool = makeTool('t1', 'srv1', [Capability.READ_SECRET]);
    const findings = runFindingsRules({ nodes: [], edges: [], servers: [server], tools: [tool], collectionId: 'col1' });
    const f = findings.find((x) => x.category === RiskCategory.SENSITIVE_DATA_EXPOSURE);
    expect(f?.severity).toBe('high');
  });

  it('fires MEDIUM for READ_SENSITIVE_MEDIUM tool with non-alarmist title', () => {
    const server = makeServer('srv1');
    const tool = makeTool('t1', 'srv1', [Capability.READ_SENSITIVE_MEDIUM]);
    const findings = runFindingsRules({ nodes: [], edges: [], servers: [server], tools: [tool], collectionId: 'col1' });
    const f = findings.find((x) => x.category === RiskCategory.SENSITIVE_DATA_EXPOSURE);
    expect(f).toBeDefined();
    expect(f?.severity).toBe('medium');
    expect(f?.title.toLowerCase()).toContain('sensitive');
    expect(f?.title.toLowerCase()).not.toContain('credential');
    expect(f?.title.toLowerCase()).not.toContain('secret');
  });

  it('does NOT fire SENSITIVE_DATA_EXPOSURE for READ_METADATA_LOW alone', () => {
    const server = makeServer('srv1');
    const tool = makeTool('t1', 'srv1', [Capability.READ_METADATA_LOW]);
    const findings = runFindingsRules({ nodes: [], edges: [], servers: [server], tools: [tool], collectionId: 'col1' });
    expect(findings.some((f) => f.category === RiskCategory.SENSITIVE_DATA_EXPOSURE)).toBe(false);
    // None of the findings should be high or critical for a metadata-only tool
    expect(findings.some((f) => f.severity === 'critical' || f.severity === 'high')).toBe(false);
  });
});

describe('runFindingsRules — PRIVILEGED_MUTATION (remote)', () => {
  it('fires MEDIUM for MUTATE_ISSUE_OR_PR tool with precise title', () => {
    const server = makeServer('srv1', 'https://api.github.com/mcp');
    const tool = makeTool('t1', 'srv1', [Capability.MUTATE_ISSUE_OR_PR, Capability.MUTATE_REMOTE_STATE]);
    const findings = runFindingsRules({ nodes: [], edges: [], servers: [server], tools: [tool], collectionId: 'col1' });
    const f = findings.find((x) => x.category === RiskCategory.PRIVILEGED_MUTATION);
    expect(f).toBeDefined();
    expect(f?.severity).toBe('medium');
    expect(f?.title.toLowerCase()).toContain('mutation');
    expect(f?.title.toLowerCase()).not.toContain('execution');
  });
});

describe('runFindingsRules — OVERBROAD_TOOL', () => {
  it('fires for a tool with 4+ capabilities', () => {
    const server = makeServer('srv1');
    const tool = makeTool('t1', 'srv1', [Capability.READ_LOCAL_FILE, Capability.WRITE_LOCAL_FILE, Capability.SEND_HTTP, Capability.QUERY_DATABASE]);
    const findings = runFindingsRules({ nodes: [], edges: [], servers: [server], tools: [tool], collectionId: 'col1' });
    expect(findings.some((f) => f.category === RiskCategory.OVERBROAD_TOOL)).toBe(true);
  });

  it('does NOT fire for a tool with 2 capabilities', () => {
    const server = makeServer('srv1');
    const tool = makeTool('t1', 'srv1', [Capability.READ_LOCAL_FILE, Capability.WRITE_LOCAL_FILE]);
    const findings = runFindingsRules({ nodes: [], edges: [], servers: [server], tools: [tool], collectionId: 'col1' });
    expect(findings.some((f) => f.category === RiskCategory.OVERBROAD_TOOL)).toBe(false);
  });
});

describe('runFindingsRules — DATA_EXFILTRATION (paths)', () => {
  it('READ_SECRET_HIGH + SEND_EXTERNAL on a SaaS server fires CRITICAL data movement', () => {
    const server = makeServer('srv1', 'https://api.github.com/mcp');
    const t1 = makeTool('t1', 'srv1', [Capability.READ_SECRET_HIGH]);
    const t2 = makeTool('t2', 'srv1', [Capability.SEND_EXTERNAL, Capability.SEND_HTTP]);
    const findings = runFindingsRules({ nodes: [], edges: [], servers: [server], tools: [t1, t2], collectionId: 'col1' });
    const f = findings.find((x) => x.category === RiskCategory.DATA_EXFILTRATION);
    expect(f).toBeDefined();
    expect(f?.severity).toBe('critical');
    expect(f?.boundaryCrossed).toBeDefined();
    expect(f?.sourceCapabilities?.length).toBeGreaterThan(0);
    expect(f?.sinkCapabilities?.length).toBeGreaterThan(0);
  });

  it('READ_LOCAL_FILE + SEND_EXTERNAL fires HIGH data movement', () => {
    const server = makeServer('srv1');
    const t1 = makeTool('t1', 'srv1', [Capability.READ_LOCAL_FILE]);
    const t2 = makeTool('t2', 'srv1', [Capability.SEND_HTTP, Capability.SEND_EXTERNAL]);
    const findings = runFindingsRules({ nodes: [], edges: [], servers: [server], tools: [t1, t2], collectionId: 'col1' });
    const f = findings.find((x) => x.category === RiskCategory.DATA_EXFILTRATION);
    expect(f).toBeDefined();
    expect(['high', 'critical']).toContain(f?.severity);
  });

  it('READ_SENSITIVE_MEDIUM + SEND_EXTERNAL fires MEDIUM data movement (precise text)', () => {
    const server = makeServer('srv1', 'https://api.github.com/mcp');
    const t1 = makeTool('t1', 'srv1', [Capability.READ_SENSITIVE_MEDIUM]);
    const t2 = makeTool('t2', 'srv1', [Capability.SEND_HTTP, Capability.SEND_EXTERNAL]);
    const findings = runFindingsRules({ nodes: [], edges: [], servers: [server], tools: [t1, t2], collectionId: 'col1' });
    const f = findings.find((x) => x.category === RiskCategory.DATA_EXFILTRATION);
    expect(f).toBeDefined();
    expect(f?.severity).toBe('medium');
    expect(f?.title.toLowerCase()).toContain('sensitive');
    expect(f?.title.toLowerCase()).toContain('external');
  });

  it('does NOT fire DATA_EXFILTRATION when only READ_SECRET tool (no sink)', () => {
    const server = makeServer('srv1');
    const t1 = makeTool('t1', 'srv1', [Capability.READ_SECRET]);
    const findings = runFindingsRules({ nodes: [], edges: [], servers: [server], tools: [t1], collectionId: 'col1' });
    expect(findings.some((f) => f.category === RiskCategory.DATA_EXFILTRATION)).toBe(false);
  });
});

describe('runFindingsRules — Finding schema enrichment', () => {
  it('includes confidence, staticPossible/observed/tested flags on findings', () => {
    const server = makeServer('srv1');
    const tool = makeTool('t1', 'srv1', [Capability.RUN_SHELL]);
    const findings = runFindingsRules({ nodes: [], edges: [], servers: [server], tools: [tool], collectionId: 'col1' });
    const f = findings.find((x) => x.category === RiskCategory.CODE_EXECUTION);
    expect(f?.confidence).toBeDefined();
    expect(f?.staticPossible).toBe(true);
    expect(f?.observed).toBe(false);
    expect(f?.tested).toBe(false);
  });
});
