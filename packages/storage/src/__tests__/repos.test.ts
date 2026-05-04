import { describe, it, expect, beforeEach } from 'vitest';
import { createMemoryDb } from '../db.js';
import { createCollectionsRepo } from '../repos/collections.js';
import { createServersRepo } from '../repos/servers.js';
import { createToolsRepo } from '../repos/tools.js';
import { createResourcesRepo } from '../repos/resources.js';
import { createFindingsRepo } from '../repos/findings.js';
import { createLogsRepo } from '../repos/logs.js';
import type Database from 'better-sqlite3';

let db: Database.Database;

beforeEach(() => {
  db = createMemoryDb();
});

describe('CollectionsRepo', () => {
  it('creates and reads a collection', () => {
    const repo = createCollectionsRepo(db);
    repo.create('col1', new Date().toISOString());
    const col = repo.findById('col1');
    expect(col?.id).toBe('col1');
    expect(col?.status).toBe('running');
  });

  it('completes a collection with counts', () => {
    const repo = createCollectionsRepo(db);
    repo.create('col2', new Date().toISOString());
    repo.complete('col2', { serverCount: 1, toolCount: 5, resourceCount: 2, promptCount: 0 });
    const col = repo.findById('col2');
    expect(col?.status).toBe('completed');
    expect(col?.toolCount).toBe(5);
    expect(col?.completedAt).toBeDefined();
  });

  it('marks a collection failed', () => {
    const repo = createCollectionsRepo(db);
    repo.create('col3', new Date().toISOString());
    repo.fail('col3', 'Connection refused');
    const col = repo.findById('col3');
    expect(col?.status).toBe('failed');
    expect(col?.error).toBe('Connection refused');
  });

  it('lists collections in reverse order', () => {
    const repo = createCollectionsRepo(db);
    repo.create('col4', '2024-01-01T00:00:00Z');
    repo.create('col5', '2024-01-02T00:00:00Z');
    const list = repo.list();
    expect(list[0]?.id).toBe('col5');
    expect(list[1]?.id).toBe('col4');
  });

  it('returns undefined for missing id', () => {
    const repo = createCollectionsRepo(db);
    expect(repo.findById('nonexistent')).toBeUndefined();
  });
});

describe('ServersRepo', () => {
  beforeEach(() => {
    const colRepo = createCollectionsRepo(db);
    colRepo.create('col1', new Date().toISOString());
  });

  it('upserts and reads a server', () => {
    const repo = createServersRepo(db);
    repo.upsert({
      id: 'server1',
      collection_id: 'col1',
      name: 'GitHub MCP',
      url: null,
      command: 'npx',
      args: JSON.stringify(['-y', '@modelcontextprotocol/server-github']),
      env: null,
      transport: 'stdio',
      is_verified: 0,
      created_at: new Date().toISOString(),
    });
    const servers = repo.findByCollection('col1');
    expect(servers).toHaveLength(1);
    expect(servers[0]?.name).toBe('GitHub MCP');
  });

  it('finds server by id', () => {
    const repo = createServersRepo(db);
    repo.upsert({
      id: 'srv2',
      collection_id: 'col1',
      name: 'Test',
      url: null,
      command: 'node',
      args: null,
      env: null,
      transport: 'stdio',
      is_verified: 0,
      created_at: new Date().toISOString(),
    });
    expect(repo.findById('srv2')?.name).toBe('Test');
  });
});

describe('ToolsRepo', () => {
  beforeEach(() => {
    const colRepo = createCollectionsRepo(db);
    colRepo.create('col1', new Date().toISOString());
    const srvRepo = createServersRepo(db);
    srvRepo.upsert({
      id: 'srv1',
      collection_id: 'col1',
      name: 'Test Server',
      url: null,
      command: 'node',
      args: null,
      env: null,
      transport: 'stdio',
      is_verified: 0,
      created_at: new Date().toISOString(),
    });
  });

  it('upserts and reads tools', () => {
    const repo = createToolsRepo(db);
    repo.upsert({
      id: 'tool1',
      collection_id: 'col1',
      server_id: 'srv1',
      name: 'read_file',
      description: 'Reads a file',
      input_schema: JSON.stringify({ type: 'object' }),
      capabilities: JSON.stringify(['READ_LOCAL_FILE']),
      source_role: JSON.stringify(['DATA_SOURCE']),
      is_untrusted: 0,
      is_instruction_capable: 0,
      content_origin: 'local',
      trust_zone: null,
      risk_score: 30,
      created_at: new Date().toISOString(),
    });
    const tools = repo.findByServer('srv1');
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('read_file');
    expect(tools[0]?.risk_score).toBe(30);
  });

  it('finds tools by collection', () => {
    const repo = createToolsRepo(db);
    repo.upsert({
      id: 'tool2',
      collection_id: 'col1',
      server_id: 'srv1',
      name: 'run_shell',
      description: null,
      input_schema: null,
      capabilities: JSON.stringify(['RUN_SHELL']),
      source_role: JSON.stringify([]),
      is_untrusted: 0,
      is_instruction_capable: 0,
      content_origin: 'local',
      trust_zone: null,
      risk_score: 90,
      created_at: new Date().toISOString(),
    });
    const tools = repo.findByCollection('col1');
    expect(tools.length).toBeGreaterThan(0);
  });
});

describe('ResourcesRepo', () => {
  beforeEach(() => {
    const colRepo = createCollectionsRepo(db);
    colRepo.create('col1', new Date().toISOString());
    const srvRepo = createServersRepo(db);
    srvRepo.upsert({
      id: 'srv1',
      collection_id: 'col1',
      name: 'Test',
      url: null,
      command: 'node',
      args: null,
      env: null,
      transport: 'stdio',
      is_verified: 0,
      created_at: new Date().toISOString(),
    });
  });

  it('upserts and reads resources', () => {
    const repo = createResourcesRepo(db);
    repo.upsert({
      id: 'res1',
      collection_id: 'col1',
      server_id: 'srv1',
      uri: 'file:///etc/passwd',
      name: 'passwd',
      description: null,
      mime_type: 'text/plain',
      created_at: new Date().toISOString(),
    });
    expect(repo.findByServer('srv1')).toHaveLength(1);
  });
});

describe('FindingsRepo', () => {
  beforeEach(() => {
    const colRepo = createCollectionsRepo(db);
    colRepo.create('col1', new Date().toISOString());
  });

  it('inserts and retrieves findings ordered by severity', () => {
    const repo = createFindingsRepo(db);
    repo.insert({
      id: 'f1',
      collection_id: 'col1',
      category: 'CODE_EXECUTION',
      severity: 'critical',
      title: 'RCE',
      description: 'Shell execution possible',
      affected_node_ids: '[]',
      remediation_hint: null,
      created_at: new Date().toISOString(),
    });
    repo.insert({
      id: 'f2',
      collection_id: 'col1',
      category: 'UNVERIFIED_SERVER',
      severity: 'medium',
      title: 'Unverified',
      description: 'Server not verified',
      affected_node_ids: '[]',
      remediation_hint: null,
      created_at: new Date().toISOString(),
    });
    const findings = repo.findByCollection('col1');
    expect(findings[0]?.severity).toBe('critical');
    expect(findings[1]?.severity).toBe('medium');
  });

  it('round-trips cross-server fields when present', () => {
    const repo = createFindingsRepo(db);
    repo.insert({
      id: 'f-cross',
      collection_id: 'col1',
      category: 'DATA_EXFILTRATION',
      severity: 'high',
      title: 'Cross server',
      description: 'Cross-server path',
      affected_node_ids: '[]',
      remediation_hint: null,
      created_at: new Date().toISOString(),
      is_cross_server: 1,
      source_server_id: 'srv-a',
      sink_server_id: 'srv-b',
      crosses_trust_boundary: 1,
      trust_transition: 'LOCAL → EXTERNAL',
      sub_category: 'TRUST_BOUNDARY_CONFIRMED',
      injection_confirmed: 1,
      trust_boundary_confirmed: 1,
      trust_boundary_exploit_confirmed: 1,
      baseline_plan: JSON.stringify([
        { step: 1, toolName: 'issue_read', input: {}, output: {} },
      ]),
    });

    const finding = repo.findById('f-cross');
    expect(finding?.isCrossServer).toBe(true);
    expect(finding?.sourceServerId).toBe('srv-a');
    expect(finding?.sinkServerId).toBe('srv-b');
    expect(finding?.crossesTrustBoundary).toBe(true);
    expect(finding?.trustTransition).toBe('LOCAL → EXTERNAL');
    expect(finding?.subCategory).toBe('TRUST_BOUNDARY_CONFIRMED');
    expect(finding?.injectionConfirmed).toBe(true);
    expect(finding?.trustBoundaryConfirmed).toBe(true);
    expect(finding?.trustBoundaryExploitConfirmed).toBe(true);
    expect(finding?.baselinePlan?.length).toBe(1);
  });

  it('does not populate cross-server ids when not provided', () => {
    const repo = createFindingsRepo(db);
    repo.insert({
      id: 'f-same',
      collection_id: 'col1',
      category: 'UNVERIFIED_SERVER',
      severity: 'low',
      title: 'Same server',
      description: 'No cross-server ids',
      affected_node_ids: '[]',
      remediation_hint: null,
      created_at: new Date().toISOString(),
      is_cross_server: 0,
    });

    const finding = repo.findById('f-same');
    expect(finding?.isCrossServer).toBe(false);
    expect(finding?.sourceServerId).toBeUndefined();
    expect(finding?.sinkServerId).toBeUndefined();
  });
});

describe('LogsRepo', () => {
  it('inserts and queries logs with pagination metadata support', () => {
    const repo = createLogsRepo(db);
    repo.insert({
      id: 'log-1',
      timestamp: '2024-01-01T00:00:00.000Z',
      level: 'info',
      phase: 'collect',
      collection_id: 'col-a',
      server_id: null,
      tool_id: null,
      finding_id: null,
      test_run_id: null,
      event_type: 'collect.start',
      message: 'Collect started',
      details_json: null,
      redacted: 0,
    });
    repo.insert({
      id: 'log-2',
      timestamp: '2024-01-01T00:00:01.000Z',
      level: 'error',
      phase: 'test',
      collection_id: 'col-a',
      server_id: 'srv-1',
      tool_id: null,
      finding_id: 'f-1',
      test_run_id: 'tr-1',
      event_type: 'test.execution.blocked',
      message: 'Blocked',
      details_json: '{"reason":"policy"}',
      redacted: 1,
    });

    const result = repo.query({ collectionId: 'col-a', limit: 1, offset: 0 });
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe('log-2');
    expect(result.items[0]?.redacted).toBe(true);
  });

  it('filters logs by finding and search query', () => {
    const repo = createLogsRepo(db);
    repo.insert({
      id: 'log-a',
      timestamp: '2024-01-01T00:00:00.000Z',
      level: 'warn',
      phase: 'test',
      collection_id: 'col-a',
      server_id: null,
      tool_id: null,
      finding_id: 'finding-1',
      test_run_id: null,
      event_type: 'test.execution.canary.not_observed',
      message: 'Canary not observed',
      details_json: null,
      redacted: 0,
    });
    repo.insert({
      id: 'log-b',
      timestamp: '2024-01-01T00:00:01.000Z',
      level: 'info',
      phase: 'analyze',
      collection_id: 'col-a',
      server_id: null,
      tool_id: null,
      finding_id: 'finding-2',
      test_run_id: null,
      event_type: 'analyze.end',
      message: 'Analyze completed',
      details_json: null,
      redacted: 0,
    });

    const filtered = repo.query({ findingId: 'finding-1', q: 'Canary' });
    expect(filtered.total).toBe(1);
    expect(filtered.items[0]?.id).toBe('log-a');
  });
});
