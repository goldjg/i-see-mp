export interface Collection {
  id: string;
  startedAt: string;
  completedAt?: string;
  serverCount: number;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  status: 'running' | 'completed' | 'failed';
  error?: string;
}

export interface Server {
  id: string;
  collectionId: string;
  name: string;
  url: string | null;
  command: string | null;
  transport: string;
  isVerified: boolean;
}

export interface Tool {
  id: string;
  collectionId: string;
  serverId: string;
  name: string;
  description: string | null;
  capabilities: string[];
  riskScore: number;
}

export interface GraphNode {
  id: string;
  type: string;
  label: string;
  serverId?: string;
  capabilities: string[];
  riskScore: number;
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
}

export interface Finding {
  id: string;
  collectionId: string;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description: string;
  affectedNodeIds: string[];
  remediationHint?: string;
  createdAt: string;
  confidence?: 'low' | 'medium' | 'high';
  staticPossible?: boolean;
  observed?: boolean;
  tested?: boolean;
  pathStatus?: 'static_possible' | 'tested_confirmed' | 'tested_rejected' | 'tested_inconclusive';
  testRunIds?: string[];
  candidatePathId?: string;
  isCrossServer?: boolean;
  sourceServerId?: string;
  sinkServerId?: string;
  crossesTrustBoundary?: boolean;
  trustTransition?: string;
  isHighSignal?: boolean;
  trifectaStage?: 'COMPLETE' | 'PARTIAL' | 'CAPABILITY_ONLY';
  trifectaScore?: number;
  trifectaComplete?: boolean;
  lethalTrifectaStatus?: 'NONE' | 'CANDIDATE' | 'COMPLETE';
  hasPrivateDataAccess?: boolean;
  hasUntrustedContentExposure?: boolean;
  hasExternalCommunication?: boolean;
  pathSummary?: string;
  sourceCapabilities?: string[];
  sinkCapabilities?: string[];
  explanation?: string;
}

export interface ToolCallRecord {
  step: number;
  toolName: string;
  toolId?: string;
  input: Record<string, unknown>;
  output: unknown;
  error?: string;
  durationMs?: number;
}

export interface TestRun {
  id: string;
  collectionId: string;
  profile: string;
  testCaseId: string;
  testCaseName: string;
  candidatePathId?: string;
  serverId?: string;
  sourceToolId?: string;
  sinkToolId?: string;
  outcome?: 'TESTED_CONFIRMED' | 'TESTED_REJECTED' | 'TESTED_INCONCLUSIVE' | 'TEST_SKIPPED' | 'TEST_ERROR';
  pathSummary?: string;
  plan: string;
  toolCalls: ToolCallRecord[];
  canaryExpected?: string;
  canaryObserved: boolean;
  status: string;
  pathStatus: 'static_possible' | 'tested_confirmed' | 'tested_rejected' | 'tested_inconclusive';
  timestamp?: string;
  startedAt: string;
  completedAt?: string;
  notes?: string;
}

export interface EvidenceRecord {
  id: string;
  testRunId: string;
  type: string;
  content: Record<string, unknown>;
  createdAt: string;
}

export interface TestRunDetail extends TestRun {
  evidence: EvidenceRecord[];
}

const BASE = '';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API error ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

export const api = {
  collections: () => get<Collection[]>('/collections'),
  servers: (collectionId?: string) =>
    get<Server[]>(`/servers${collectionId ? `?collectionId=${collectionId}` : ''}`),
  tools: (collectionId?: string) =>
    get<Tool[]>(`/tools${collectionId ? `?collectionId=${collectionId}` : ''}`),
  graph: (collectionId?: string) =>
    get<{ nodes: GraphNode[]; edges: GraphEdge[] }>(
      `/graph${collectionId ? `?collectionId=${collectionId}` : ''}`,
    ),
  findings: (collectionId?: string) =>
    get<Finding[]>(`/findings${collectionId ? `?collectionId=${collectionId}` : ''}`),
  testRuns: (params?: { collectionId?: string; findingId?: string }) => {
    const q = new URLSearchParams();
    if (params?.collectionId) q.set('collectionId', params.collectionId);
    if (params?.findingId) q.set('findingId', params.findingId);
    const qs = q.toString();
    return get<TestRun[]>(`/test-runs${qs ? `?${qs}` : ''}`);
  },
  testRun: (id: string) => get<TestRunDetail>(`/test-runs/${encodeURIComponent(id)}`),
  evidence: (testRunId: string) =>
    get<EvidenceRecord[]>(`/evidence/${encodeURIComponent(testRunId)}`),
};
