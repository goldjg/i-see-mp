import Fastify from 'fastify';
import staticPlugin from '@fastify/static';
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

  if (options.staticDir) {
    app.register(staticPlugin, {
      root: options.staticDir,
      prefix: '/',
    });
  }

  return app;
}
