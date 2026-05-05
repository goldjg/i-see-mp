import { Capability, NodeType } from '@iseemp/core';
import type { GraphNode, GraphEdge } from '@iseemp/core';

export interface AttackPath {
  id: string;
  nodeIds: string[];
  edgeIds: string[];
  riskScore: number;
  description: string;
}

export interface PromptInjectionCandidateChain {
  instructionSourceNodeId: string;
  privateDataNodeId: string;
  sinkNodeId: string;
}

function buildAdjacency(edges: GraphEdge[]): Map<string, GraphEdge[]> {
  const adj = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const list = adj.get(edge.source) ?? [];
    list.push(edge);
    adj.set(edge.source, list);
  }
  return adj;
}

function nodeMap(nodes: GraphNode[]): Map<string, GraphNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

function bfsPath(
  start: string,
  targetFn: (node: GraphNode) => boolean,
  adj: Map<string, GraphEdge[]>,
  nodeById: Map<string, GraphNode>,
): { nodeIds: string[]; edgeIds: string[] } | null {
  const visited = new Set<string>();
  const queue: { nodeId: string; nodeIds: string[]; edgeIds: string[] }[] = [
    { nodeId: start, nodeIds: [start], edgeIds: [] },
  ];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (visited.has(current.nodeId)) continue;
    visited.add(current.nodeId);
    const node = nodeById.get(current.nodeId);
    if (!node) continue;
    if (current.nodeId !== start && targetFn(node)) {
      return { nodeIds: current.nodeIds, edgeIds: current.edgeIds };
    }
    for (const edge of adj.get(current.nodeId) ?? []) {
      if (!visited.has(edge.target)) {
        queue.push({
          nodeId: edge.target,
          nodeIds: [...current.nodeIds, edge.target],
          edgeIds: [...current.edgeIds, edge.id],
        });
      }
    }
  }
  return null;
}

export function findAttackPaths(nodes: GraphNode[], edges: GraphEdge[]): AttackPath[] {
  const paths: AttackPath[] = [];
  const adj = buildAdjacency(edges);
  const byId = nodeMap(nodes);

  const agentNode = nodes.find((n) => n.type === NodeType.AGENT);
  if (!agentNode) return [];

  // Path 1: Agent -> sensitive data
  const sensitiveDataNodes = nodes.filter((n) => n.type === NodeType.SENSITIVE_DATA);
  for (const target of sensitiveDataNodes) {
    const path = bfsPath(agentNode.id, (n) => n.id === target.id, adj, byId);
    if (path) {
      const risk = Math.max(...path.nodeIds.map((id) => byId.get(id)?.riskScore ?? 0));
      paths.push({
        id: `path:agent->sensitive:${target.id}`,
        nodeIds: path.nodeIds,
        edgeIds: path.edgeIds,
        riskScore: risk,
        description: `Agent can reach sensitive data node "${target.label}"`,
      });
    }
  }

  // Path 2: Agent -> nodes with RUN_SHELL/EXECUTE_CODE capability
  const execNodes = nodes.filter(
    (n) =>
      n.type === NodeType.TOOL &&
      (n.capabilities.includes(Capability.RUN_SHELL) ||
        n.capabilities.includes(Capability.EXECUTE_CODE)),
  );
  for (const target of execNodes) {
    const path = bfsPath(agentNode.id, (n) => n.id === target.id, adj, byId);
    if (path) {
      paths.push({
        id: `path:agent->exec:${target.id}`,
        nodeIds: path.nodeIds,
        edgeIds: path.edgeIds,
        riskScore: target.riskScore,
        description: `Agent can reach code-execution tool "${target.label}"`,
      });
    }
  }

  // Path 3: Paths that cross trust boundaries
  const boundaryNodes = nodes.filter((n) => n.type === NodeType.TRUST_BOUNDARY);
  for (const boundary of boundaryNodes) {
    const path = bfsPath(agentNode.id, (n) => n.id === boundary.id, adj, byId);
    if (path) {
      paths.push({
        id: `path:agent->boundary:${boundary.id}`,
        nodeIds: path.nodeIds,
        edgeIds: path.edgeIds,
        riskScore: 70,
        description: `Agent path crosses network trust boundary`,
      });
    }
  }

  return paths;
}

export function findPromptInjectionCandidateChains(
  nodes: GraphNode[],
): PromptInjectionCandidateChain[] {
  const instructionSources = nodes.filter((n) => n.type === NodeType.INSTRUCTION_SOURCE);
  const privateDataTools = nodes.filter(
    (n) =>
      n.type === NodeType.TOOL &&
      (n.capabilities.includes(Capability.READ_CREDENTIAL_HIGH) ||
        n.capabilities.includes(Capability.READ_SECRET_HIGH) ||
        n.capabilities.includes(Capability.READ_SECRET) ||
        n.capabilities.includes(Capability.READ_LOCAL_FILE) ||
        n.capabilities.includes(Capability.READ_SENSITIVE_MEDIUM)),
  );
  const sinkTools = nodes.filter(
    (n) =>
      n.type === NodeType.TOOL &&
      (n.capabilities.includes(Capability.SEND_EXTERNAL) ||
        n.capabilities.includes(Capability.SEND_HTTP) ||
        n.capabilities.includes(Capability.SEND_EMAIL) ||
        n.capabilities.includes(Capability.MUTATE_REMOTE_STATE) ||
        n.capabilities.includes(Capability.MUTATE_REPOSITORY) ||
        n.capabilities.includes(Capability.MUTATE_ISSUE_OR_PR)),
  );

  const chains: PromptInjectionCandidateChain[] = [];
  for (const instructionSource of instructionSources) {
    for (const privateDataTool of privateDataTools) {
      for (const sinkTool of sinkTools) {
        chains.push({
          instructionSourceNodeId: instructionSource.id,
          privateDataNodeId: privateDataTool.id,
          sinkNodeId: sinkTool.id,
        });
      }
    }
  }
  return chains;
}
