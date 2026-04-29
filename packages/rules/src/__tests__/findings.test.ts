import { describe, it, expect } from 'vitest';
import { runFindingsRules } from '../findings-rules.js';
import { Capability, RiskCategory } from '@mcphound/core';

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
  it('fires for RUN_SHELL tool', () => {
    const server = makeServer('srv1');
    const tool = makeTool('t1', 'srv1', [Capability.RUN_SHELL]);
    const findings = runFindingsRules({ nodes: [], edges: [], servers: [server], tools: [tool], collectionId: 'col1' });
    expect(findings.some((f) => f.category === RiskCategory.CODE_EXECUTION)).toBe(true);
  });

  it('fires for EXECUTE_CODE tool', () => {
    const server = makeServer('srv1');
    const tool = makeTool('t1', 'srv1', [Capability.EXECUTE_CODE]);
    const findings = runFindingsRules({ nodes: [], edges: [], servers: [server], tools: [tool], collectionId: 'col1' });
    expect(findings.some((f) => f.category === RiskCategory.CODE_EXECUTION)).toBe(true);
  });
});

describe('runFindingsRules — SENSITIVE_DATA_EXPOSURE', () => {
  it('fires for READ_SECRET tool', () => {
    const server = makeServer('srv1');
    const tool = makeTool('t1', 'srv1', [Capability.READ_SECRET]);
    const findings = runFindingsRules({ nodes: [], edges: [], servers: [server], tools: [tool], collectionId: 'col1' });
    expect(findings.some((f) => f.category === RiskCategory.SENSITIVE_DATA_EXPOSURE)).toBe(true);
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

describe('runFindingsRules — DANGEROUS_TOOL_CHAIN', () => {
  it('fires when server has both READ_SECRET and SEND_HTTP tools', () => {
    const server = makeServer('srv1');
    const t1 = makeTool('t1', 'srv1', [Capability.READ_SECRET]);
    const t2 = makeTool('t2', 'srv1', [Capability.SEND_HTTP]);
    const findings = runFindingsRules({ nodes: [], edges: [], servers: [server], tools: [t1, t2], collectionId: 'col1' });
    expect(findings.some((f) => f.category === RiskCategory.DANGEROUS_TOOL_CHAIN)).toBe(true);
    expect(findings.find((f) => f.category === RiskCategory.DANGEROUS_TOOL_CHAIN)?.severity).toBe('critical');
  });

  it('does NOT fire when only READ_SECRET tool', () => {
    const server = makeServer('srv1');
    const t1 = makeTool('t1', 'srv1', [Capability.READ_SECRET]);
    const findings = runFindingsRules({ nodes: [], edges: [], servers: [server], tools: [t1], collectionId: 'col1' });
    expect(findings.some((f) => f.category === RiskCategory.DANGEROUS_TOOL_CHAIN)).toBe(false);
  });
});

describe('runFindingsRules — DATA_EXFILTRATION', () => {
  it('fires when server has READ_LOCAL_FILE + SEND_HTTP tools', () => {
    const server = makeServer('srv1');
    const t1 = makeTool('t1', 'srv1', [Capability.READ_LOCAL_FILE]);
    const t2 = makeTool('t2', 'srv1', [Capability.SEND_HTTP]);
    const findings = runFindingsRules({ nodes: [], edges: [], servers: [server], tools: [t1, t2], collectionId: 'col1' });
    expect(findings.some((f) => f.category === RiskCategory.DATA_EXFILTRATION)).toBe(true);
    expect(findings.find((f) => f.category === RiskCategory.DATA_EXFILTRATION)?.severity).toBe('critical');
  });
});
