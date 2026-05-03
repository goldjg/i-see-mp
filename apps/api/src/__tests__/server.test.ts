import { describe, it, expect } from 'vitest';
import { buildServer } from '../server.js';
import {
  createMemoryDb,
  createCollectionsRepo,
  createServersRepo,
  createToolsRepo,
  createFindingsRepo,
  createTestRunsRepo,
  createEvidenceRepo,
  testRunToRow,
  evidenceToRow,
} from '@iseemp/storage';
import { Capability } from '@iseemp/core';

// Patch getDb to return memory db for tests
import * as storage from '@iseemp/storage';
import { vi } from 'vitest';

describe('API routes', () => {
  it('GET /health returns ok', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { status: string };
    expect(body.status).toBe('ok');
  });

  it('GET /collections returns empty array when no db data', async () => {
    // Use in-memory db
    const db = createMemoryDb();
    vi.spyOn(storage, 'getDb').mockReturnValue(db);
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/collections' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
    vi.restoreAllMocks();
  });

  it('GET /servers returns empty when no collection', async () => {
    const db = createMemoryDb();
    vi.spyOn(storage, 'getDb').mockReturnValue(db);
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/servers' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
    vi.restoreAllMocks();
  });

  it('GET /tools returns tools for latest collection', async () => {
    const db = createMemoryDb();
    vi.spyOn(storage, 'getDb').mockReturnValue(db);

    const colRepo = createCollectionsRepo(db);
    const srvRepo = createServersRepo(db);
    const toolRepo = createToolsRepo(db);
    const now = new Date().toISOString();

    colRepo.create('col1', now);
    colRepo.complete('col1', { serverCount: 1, toolCount: 1, resourceCount: 0, promptCount: 0 });
    srvRepo.upsert({ id: 'srv1', collection_id: 'col1', name: 'Test', url: null, command: 'node', args: null, env: null, transport: 'stdio', is_verified: 0, created_at: now });
    toolRepo.upsert({ id: 'tool1', collection_id: 'col1', server_id: 'srv1', name: 'read_file', description: 'Reads a file', input_schema: null, capabilities: JSON.stringify([Capability.READ_LOCAL_FILE]), risk_score: 30, created_at: now });

    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/tools' });
    expect(res.statusCode).toBe(200);
    const tools = JSON.parse(res.body) as Array<{ name: string }>;
    expect(tools.some((t) => t.name === 'read_file')).toBe(true);
    vi.restoreAllMocks();
  });

  it('GET /findings returns empty when no findings', async () => {
    const db = createMemoryDb();
    vi.spyOn(storage, 'getDb').mockReturnValue(db);

    const colRepo = createCollectionsRepo(db);
    colRepo.create('col1', new Date().toISOString());
    colRepo.complete('col1', { serverCount: 0, toolCount: 0, resourceCount: 0, promptCount: 0 });

    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/findings' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
    vi.restoreAllMocks();
  });

  it('GET /findings returns trifecta-annotated findings', async () => {
    const db = createMemoryDb();
    vi.spyOn(storage, 'getDb').mockReturnValue(db);

    const now = new Date().toISOString();
    const colRepo = createCollectionsRepo(db);
    const findingsRepo = createFindingsRepo(db);
    colRepo.create('col1', now);
    colRepo.complete('col1', { serverCount: 1, toolCount: 2, resourceCount: 0, promptCount: 0 });
    findingsRepo.insert({
      id: 'f-annotated',
      collection_id: 'col1',
      category: 'DATA_EXFILTRATION',
      severity: 'critical',
      title: 'chain',
      description: 'chain',
      affected_node_ids: '[]',
      remediation_hint: null,
      created_at: now,
      source_capabilities: JSON.stringify([Capability.READ_SECRET_HIGH]),
      sink_capabilities: JSON.stringify([Capability.SEND_EXTERNAL]),
      boundary_crossed: 'SAAS',
    });

    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/findings' });
    expect(res.statusCode).toBe(200);
    const out = JSON.parse(res.body) as Array<{
      id: string;
      trifectaStage?: string;
      trifectaScore?: number;
      trifectaComplete?: boolean;
    }>;
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('f-annotated');
    expect(out[0]?.trifectaStage).toBe('COMPLETE');
    expect(out[0]?.trifectaScore).toBe(11);
    expect(out[0]?.trifectaComplete).toBe(true);
    vi.restoreAllMocks();
  });

  it('GET /graph returns nodes and edges', async () => {
    const db = createMemoryDb();
    vi.spyOn(storage, 'getDb').mockReturnValue(db);

    const colRepo = createCollectionsRepo(db);
    const srvRepo = createServersRepo(db);
    const now = new Date().toISOString();

    colRepo.create('col1', now);
    colRepo.complete('col1', { serverCount: 1, toolCount: 0, resourceCount: 0, promptCount: 0 });
    srvRepo.upsert({ id: 'srv1', collection_id: 'col1', name: 'Test', url: null, command: 'node', args: null, env: null, transport: 'stdio', is_verified: 0, created_at: now });

    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/graph' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { nodes: unknown[]; edges: unknown[] };
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(Array.isArray(body.edges)).toBe(true);
    vi.restoreAllMocks();
  });

  it('GET /test-runs and /test-runs/:id and /evidence/:testRunId', async () => {
    const db = createMemoryDb();
    vi.spyOn(storage, 'getDb').mockReturnValue(db);

    const now = new Date().toISOString();
    createCollectionsRepo(db).create('col1', now);
    const trRepo = createTestRunsRepo(db);
    const evRepo = createEvidenceRepo(db);
    const findingsRepo = createFindingsRepo(db);
    findingsRepo.insert({
      id: 'f-1',
      collection_id: 'col1',
      category: 'DATA_EXFILTRATION',
      severity: 'high',
      title: 'test',
      description: 'test',
      affected_node_ids: '[]',
      remediation_hint: null,
      created_at: now,
      tested: 1,
      path_status: 'tested_confirmed',
      candidate_path_id: 'cp-1',
    });
    trRepo.insert(
      testRunToRow({
        id: 'tr-1',
        collectionId: 'col1',
        profile: 'safe',
        testCaseId: 'READ_SECRET_HIGH_TO_SEND_EXTERNAL',
        testCaseName: 'Secret read',
        candidatePathId: 'cp-1',
        plan: 'plan',
        toolCalls: [],
        canaryObserved: true,
        outcome: 'TESTED_CONFIRMED',
        status: 'confirmed',
        pathStatus: 'tested_confirmed',
        startedAt: now,
      }),
    );
    evRepo.insert(
      evidenceToRow({
        id: 'ev-1',
        testRunId: 'tr-1',
        candidatePathId: 'cp-1',
        type: 'plan',
        content: { hello: 'world' },
        createdAt: now,
      }),
    );

    const app = buildServer();

    const list = await app.inject({ method: 'GET', url: '/test-runs' });
    expect(list.statusCode).toBe(200);
    expect(JSON.parse(list.body)).toHaveLength(1);

    const byFinding = await app.inject({ method: 'GET', url: '/test-runs?findingId=f-1' });
    expect(JSON.parse(byFinding.body)).toHaveLength(1);

    const detail = await app.inject({ method: 'GET', url: '/test-runs/tr-1' });
    expect(detail.statusCode).toBe(200);
    const detailBody = JSON.parse(detail.body) as { id: string; evidence: Array<{ id: string }> };
    expect(detailBody.id).toBe('tr-1');
    expect(detailBody.evidence).toHaveLength(1);

    const missing = await app.inject({ method: 'GET', url: '/test-runs/does-not-exist' });
    expect(missing.statusCode).toBe(404);

    const ev = await app.inject({ method: 'GET', url: '/evidence/tr-1' });
    expect(ev.statusCode).toBe(200);
    expect(JSON.parse(ev.body)).toHaveLength(1);

    vi.restoreAllMocks();
  });
});
