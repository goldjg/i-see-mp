import { describe, it, expect } from 'vitest';
import { buildGraph } from '../builder.js';
import { findAttackPaths, findPromptInjectionCandidateChains } from '../queries.js';
import { NodeType, EdgeType, Capability } from '@iseemp/core';

const now = new Date().toISOString();

const server1 = {
  id: 'srv1',
  collection_id: 'col1',
  name: 'Local GitHub MCP',
  url: null,
  command: 'npx',
  args: null,
  env: null,
  transport: 'stdio',
  is_verified: 0,
  created_at: now,
};

const server2 = {
  id: 'srv2',
  collection_id: 'col1',
  name: 'Remote MCP',
  url: 'https://api.example.com/mcp',
  command: null,
  args: null,
  env: null,
  transport: 'sse',
  is_verified: 0,
  created_at: now,
};

const tool1 = {
  id: 'tool1',
  collection_id: 'col1',
  server_id: 'srv1',
  name: 'run_shell',
  description: null,
  input_schema: null,
  capabilities: JSON.stringify([Capability.RUN_SHELL, Capability.EXECUTE_CODE]),
  source_role: JSON.stringify([]),
  is_untrusted: 0,
  is_instruction_capable: 0,
  content_origin: 'local',
  trust_zone: null,
  risk_score: 90,
  classification_evidence: null,
  created_at: now,
};

const tool2 = {
  id: 'tool2',
  collection_id: 'col1',
  server_id: 'srv2',
  name: 'get_secret',
  description: null,
  input_schema: null,
  capabilities: JSON.stringify([Capability.READ_SECRET]),
  source_role: JSON.stringify(['DATA_SOURCE']),
  is_untrusted: 0,
  is_instruction_capable: 0,
  content_origin: 'external_saas',
  trust_zone: null,
  risk_score: 80,
  classification_evidence: null,
  created_at: now,
};

const tool3 = {
  id: 'tool3',
  collection_id: 'col1',
  server_id: 'srv2',
  name: 'issue_read',
  description: null,
  input_schema: null,
  capabilities: JSON.stringify([
    Capability.READ_REMOTE_DATA,
    Capability.UNTRUSTED_CONTENT_EXPOSURE,
  ]),
  source_role: JSON.stringify(['DATA_SOURCE', 'INSTRUCTION_SOURCE']),
  is_untrusted: 1,
  is_instruction_capable: 1,
  content_origin: 'user_generated',
  trust_zone: null,
  risk_score: 60,
  classification_evidence: null,
  created_at: now,
};

describe('buildGraph', () => {
  it('creates agent node', () => {
    const { nodes } = buildGraph({
      collectionId: 'col1',
      servers: [server1],
      tools: [],
      resources: [],
      prompts: [],
    });
    expect(nodes.some((n) => n.type === NodeType.AGENT)).toBe(true);
  });

  it('creates server nodes', () => {
    const { nodes } = buildGraph({
      collectionId: 'col1',
      servers: [server1, server2],
      tools: [],
      resources: [],
      prompts: [],
    });
    expect(nodes.filter((n) => n.type === NodeType.MCP_SERVER)).toHaveLength(2);
  });

  it('creates tool nodes', () => {
    const { nodes } = buildGraph({
      collectionId: 'col1',
      servers: [server1],
      tools: [tool1],
      resources: [],
      prompts: [],
    });
    expect(nodes.some((n) => n.type === NodeType.TOOL && n.label === 'run_shell')).toBe(true);
  });

  it('creates trust boundary for remote server', () => {
    const { nodes } = buildGraph({
      collectionId: 'col1',
      servers: [server2],
      tools: [],
      resources: [],
      prompts: [],
    });
    expect(nodes.some((n) => n.type === NodeType.TRUST_BOUNDARY)).toBe(true);
  });

  it('does NOT create trust boundary for local server', () => {
    const { nodes } = buildGraph({
      collectionId: 'col1',
      servers: [server1],
      tools: [],
      resources: [],
      prompts: [],
    });
    expect(nodes.some((n) => n.type === NodeType.TRUST_BOUNDARY)).toBe(false);
  });

  it('creates sensitive_data node for READ_SECRET tool', () => {
    const { nodes } = buildGraph({
      collectionId: 'col1',
      servers: [server2],
      tools: [tool2],
      resources: [],
      prompts: [],
    });
    expect(nodes.some((n) => n.type === NodeType.SENSITIVE_DATA)).toBe(true);
  });

  it('creates can_call edge from agent to server', () => {
    const { edges } = buildGraph({
      collectionId: 'col1',
      servers: [server1],
      tools: [],
      resources: [],
      prompts: [],
    });
    expect(edges.some((e) => e.type === EdgeType.CAN_CALL)).toBe(true);
  });

  it('creates exposes edge from server to tool', () => {
    const { edges } = buildGraph({
      collectionId: 'col1',
      servers: [server1],
      tools: [tool1],
      resources: [],
      prompts: [],
    });
    expect(edges.some((e) => e.type === EdgeType.EXPOSES)).toBe(true);
  });

  it('creates crosses_boundary edge for remote tool', () => {
    const { edges } = buildGraph({
      collectionId: 'col1',
      servers: [server2],
      tools: [tool2],
      resources: [],
      prompts: [],
    });
    expect(edges.some((e) => e.type === EdgeType.CROSSES_BOUNDARY)).toBe(true);
  });

  it('creates instruction-source node and carries_instruction edge', () => {
    const { nodes, edges } = buildGraph({
      collectionId: 'col1',
      servers: [server2],
      tools: [tool3],
      resources: [],
      prompts: [],
    });
    expect(nodes.some((n) => n.type === NodeType.INSTRUCTION_SOURCE)).toBe(true);
    expect(edges.some((e) => e.type === EdgeType.CARRIES_INSTRUCTION)).toBe(true);
  });
});

describe('findAttackPaths', () => {
  it('finds path to sensitive data', () => {
    const { nodes, edges } = buildGraph({
      collectionId: 'col1',
      servers: [server2],
      tools: [tool2],
      resources: [],
      prompts: [],
    });
    const paths = findAttackPaths(nodes, edges);
    expect(paths.some((p) => p.description.includes('sensitive data'))).toBe(true);
  });

  it('finds path to code execution tool', () => {
    const { nodes, edges } = buildGraph({
      collectionId: 'col1',
      servers: [server1],
      tools: [tool1],
      resources: [],
      prompts: [],
    });
    const paths = findAttackPaths(nodes, edges);
    expect(paths.some((p) => p.description.includes('code-execution'))).toBe(true);
  });

  it('finds path through trust boundary', () => {
    const { nodes, edges } = buildGraph({
      collectionId: 'col1',
      servers: [server2],
      tools: [],
      resources: [],
      prompts: [],
    });
    const paths = findAttackPaths(nodes, edges);
    expect(paths.some((p) => p.description.includes('trust boundary'))).toBe(true);
  });

  it('finds prompt-injection candidate chains', () => {
    const sinkTool = {
      id: 'tool4',
      collection_id: 'col1',
      server_id: 'srv2',
      name: 'send_webhook',
      description: null,
      input_schema: null,
      capabilities: JSON.stringify([Capability.SEND_EXTERNAL, Capability.SEND_HTTP]),
      source_role: JSON.stringify([]),
      is_untrusted: 0,
      is_instruction_capable: 0,
      content_origin: 'external_saas',
      trust_zone: null,
      risk_score: 65,
      classification_evidence: null,
      created_at: now,
    };
    const { nodes } = buildGraph({
      collectionId: 'col1',
      servers: [server2],
      tools: [tool2, tool3, sinkTool],
      resources: [],
      prompts: [],
    });
    const chains = findPromptInjectionCandidateChains(nodes);
    expect(chains.length).toBeGreaterThan(0);
  });
});
