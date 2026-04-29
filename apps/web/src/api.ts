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
};
