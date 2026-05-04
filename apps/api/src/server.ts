import Fastify from 'fastify';
import staticPlugin from '@fastify/static';
import { randomUUID } from 'node:crypto';
import {
  getDb,
  createCollectionsRepo,
  createServersRepo,
  createToolsRepo,
  createResourcesRepo,
  createNodesRepo,
  createEdgesRepo,
  createFindingsRepo,
  createTestRunsRepo,
  createEvidenceRepo,
  createLogsRepo,
} from '@iseemp/storage';
import { buildGraph } from '@iseemp/graph';
import { applyTrifectaAnalysis } from '@iseemp/rules';

export function buildServer(options: { dbPath?: string; staticDir?: string } = {}) {
  const app = Fastify({ logger: false });

  const db = getDb(options.dbPath ?? 'iseemp.db');
  const collections = createCollectionsRepo(db);
  const servers = createServersRepo(db);
  const tools = createToolsRepo(db);
  const resources = createResourcesRepo(db);
  const nodes = createNodesRepo(db);
  const edges = createEdgesRepo(db);
  const findings = createFindingsRepo(db);
  const testRuns = createTestRunsRepo(db);
  const evidence = createEvidenceRepo(db);
  const logs = createLogsRepo(db);

  app.setErrorHandler((error, _request, reply) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logs.insert({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      level: 'error',
      phase: 'serve',
      collection_id: null,
      server_id: null,
      tool_id: null,
      finding_id: null,
      test_run_id: null,
      event_type: 'api.error',
      message: errorMessage,
      details_json: null,
      redacted: 0,
    });
    reply.code((error as { statusCode?: number }).statusCode ?? 500).send({ error: errorMessage });
  });

  app.get('/health', async () => ({
    status: 'ok',
    ts: new Date().toISOString(),
  }));

  app.get<{ Querystring: { collectionId?: string } }>('/collections', async () => {
    return collections.list();
  });

  app.get<{ Querystring: { collectionId?: string } }>('/servers', async (req) => {
    const { collectionId } = req.query;
    const col = collectionId
      ? collections.findById(collectionId)
      : collections.latest();
    if (!col) return [];
    return servers.findByCollection(col.id).map((s) => ({
      id: s.id,
      collectionId: s.collection_id,
      name: s.name,
      url: s.url,
      command: s.command,
      transport: s.transport,
      isVerified: !!s.is_verified,
    }));
  });

  app.get<{ Querystring: { collectionId?: string; serverId?: string } }>('/tools', async (req) => {
    const { collectionId, serverId } = req.query;
    const col = collectionId
      ? collections.findById(collectionId)
      : collections.latest();
    if (!col) return [];
    const allTools = serverId
      ? tools.findByServer(serverId)
      : tools.findByCollection(col.id);
    return allTools.map((t) => ({
      id: t.id,
      collectionId: t.collection_id,
      serverId: t.server_id,
      name: t.name,
      description: t.description,
      capabilities: JSON.parse(t.capabilities) as string[],
      sourceRole: JSON.parse(t.source_role) as string[],
      isUntrusted: t.is_untrusted === 1,
        isInstructionCapable: t.is_instruction_capable === 1,
        contentOrigin: t.content_origin,
        trustZone: t.trust_zone ?? undefined,
        riskScore: t.risk_score,
      }));
  });

  app.get<{ Querystring: { collectionId?: string } }>('/graph', async (req) => {
    const { collectionId } = req.query;
    const col = collectionId
      ? collections.findById(collectionId)
      : collections.latest();
    if (!col) return { nodes: [], edges: [] };

    // Return persisted graph if available, else build on-the-fly
    const persistedNodes = nodes.findByCollection(col.id);
    const persistedEdges = edges.findByCollection(col.id);
    if (persistedNodes.length > 0) {
      return { nodes: persistedNodes, edges: persistedEdges };
    }

    const srvList = servers.findByCollection(col.id);
    const toolList = tools.findByCollection(col.id);
    const resList = resources.findByCollection(col.id);
    const { nodes: builtNodes, edges: builtEdges } = buildGraph({
      collectionId: col.id,
      servers: srvList,
      tools: toolList,
      resources: resList,
      prompts: [],
    });
    return { nodes: builtNodes, edges: builtEdges };
  });

  app.get<{ Querystring: { collectionId?: string } }>('/findings', async (req) => {
    const { collectionId } = req.query;
    const col = collectionId
      ? collections.findById(collectionId)
      : collections.latest();
    if (!col) return [];
    return applyTrifectaAnalysis(findings.findByCollection(col.id));
  });

  app.get<{ Querystring: { collectionId?: string; findingId?: string } }>(
    '/test-runs',
    async (req) => {
      const { collectionId, findingId } = req.query;
      if (findingId) return testRuns.getByFindingId(findingId);
      const col = collectionId
        ? collections.findById(collectionId)
        : collections.latest();
      if (!col) return [];
      return testRuns.findByCollection(col.id);
    },
  );

  app.get<{ Params: { id: string } }>('/test-runs/:id', async (req, reply) => {
    const run = testRuns.findById(req.params.id);
    if (!run) {
      reply.code(404);
      return { error: 'test run not found' };
    }
    const ev = evidence.findByTestRun(run.id);
    return { ...run, evidence: ev };
  });

  app.get<{ Params: { testRunId: string } }>('/evidence/:testRunId', async (req) => {
    return evidence.findByTestRun(req.params.testRunId);
  });

  app.get<{
    Querystring: {
      collectionId?: string;
      findingId?: string;
      testRunId?: string;
      serverId?: string;
      toolId?: string;
      phase?: 'collect' | 'analyze' | 'test' | 'serve' | 'demo';
      level?: 'info' | 'warn' | 'error';
      q?: string;
      limit?: string;
      offset?: string;
    };
  }>('/logs', async (req) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit ?? '100', 10), 1), 500);
    const offset = Math.max(parseInt(req.query.offset ?? '0', 10), 0);
    const { items, total } = logs.query({
      collectionId: req.query.collectionId,
      findingId: req.query.findingId,
      testRunId: req.query.testRunId,
      serverId: req.query.serverId,
      toolId: req.query.toolId,
      phase: req.query.phase,
      level: req.query.level,
      q: req.query.q,
      limit,
      offset,
    });
    return {
      items,
      limit,
      offset,
      hasMore: offset + items.length < total,
    };
  });

  if (options.staticDir) {
    app.register(staticPlugin, {
      root: options.staticDir,
      prefix: '/',
    });
  }

  return app;
}
