import {
  getDb,
  createCollectionsRepo,
  createServersRepo,
  createToolsRepo,
  createResourcesRepo,
  createPromptsRepo,
  createNodesRepo,
  createEdgesRepo,
  createFindingsRepo,
  findingToRow,
  log,
} from '@iseemp/storage';
import type { NodeRow, EdgeRow, FindingRow } from '@iseemp/storage';
import { runFindingsRules } from '@iseemp/rules';
import { buildGraph } from './builder.js';
import type { Finding } from '@iseemp/core';

export async function analyze(options: {
  collectionId?: string;
  dbPath?: string;
}): Promise<Finding[]> {
  const db = getDb(options.dbPath ?? 'iseemp.db');
  const collections = createCollectionsRepo(db);
  const serversRepo = createServersRepo(db);
  const toolsRepo = createToolsRepo(db);
  const resourcesRepo = createResourcesRepo(db);
  const promptsRepo = createPromptsRepo(db);
  const nodesRepo = createNodesRepo(db);
  const edgesRepo = createEdgesRepo(db);
  const findingsRepo = createFindingsRepo(db);

  const col = options.collectionId
    ? collections.findById(options.collectionId)
    : collections.latest();

  if (!col) {
    throw new Error('No collection found. Run iseemp collect first.');
  }

  const collectionId = col.id;
  log(db, {
    level: 'info',
    phase: 'analyze',
    eventType: 'analyze.start',
    message: 'Analyze started',
    collectionId,
  });

  const servers = serversRepo.findByCollection(collectionId);
  const tools = toolsRepo.findByCollection(collectionId);
  const resources = resourcesRepo.findByCollection(collectionId);
  const prompts = promptsRepo.findByCollection(collectionId);

  let nodes: ReturnType<typeof buildGraph>['nodes'];
  let edges: ReturnType<typeof buildGraph>['edges'];
  try {
    const built = buildGraph({ collectionId, servers, tools, resources, prompts });
    nodes = built.nodes;
    edges = built.edges;
  } catch (err) {
    log(db, {
      level: 'error',
      phase: 'analyze',
      eventType: 'analyze.graph_build.error',
      message: err instanceof Error ? err.message : String(err),
      collectionId,
    });
    throw err;
  }

  // Persist nodes
  const nodeRows: NodeRow[] = nodes.map((n) => ({
    id: n.id,
    collection_id: collectionId,
    type: n.type,
    label: n.label,
    server_id: n.serverId ?? null,
    capabilities: JSON.stringify(n.capabilities),
    risk_score: n.riskScore,
    trust_zone: n.trustBoundary ?? null,
    metadata: n.metadata ? JSON.stringify(n.metadata) : null,
    created_at: new Date().toISOString(),
  }));
  nodesRepo.deleteByCollection(collectionId);
  nodesRepo.upsertMany(nodeRows);

  // Persist edges
  const edgeRows: EdgeRow[] = edges.map((e) => ({
    id: e.id,
    collection_id: collectionId,
    source: e.source,
    target: e.target,
    type: e.type,
    metadata: e.metadata ? JSON.stringify(e.metadata) : null,
    created_at: new Date().toISOString(),
  }));
  edgesRepo.deleteByCollection(collectionId);
  edgesRepo.upsertMany(edgeRows);

  // Run findings rules
  let findings: Finding[];
  try {
    findings = runFindingsRules({ nodes, edges, servers, tools, collectionId });
  } catch (err) {
    log(db, {
      level: 'error',
      phase: 'analyze',
      eventType: 'analyze.findings_rules.error',
      message: err instanceof Error ? err.message : String(err),
      collectionId,
    });
    throw err;
  }

  // Persist findings (with rich fields)
  const findingRows: FindingRow[] = findings.map((f) => findingToRow(f));
  findingsRepo.deleteByCollection(collectionId);
  findingsRepo.insertMany(findingRows);
  log(db, {
    level: 'info',
    phase: 'analyze',
    eventType: 'analyze.end',
    message: 'Analyze completed',
    collectionId,
    details: {
      nodes: nodes.length,
      edges: edges.length,
      findings: findings.length,
    },
  });

  return findings;
}
