import { describe, it, expect, beforeEach } from 'vitest';
import { buildServer } from '../server.js';
import { createMemoryDb, createCollectionsRepo, createServersRepo, createToolsRepo, createFindingsRepo } from '@iseemp/storage';
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
});
