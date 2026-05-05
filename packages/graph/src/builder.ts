import { NodeType, EdgeType, Capability, TrustBoundary, SourceRole } from '@iseemp/core';
import type { GraphNode, GraphEdge } from '@iseemp/core';
import type { ServerRow, ToolRow, ResourceRow, PromptRow } from '@iseemp/storage';

interface BuildContext {
  collectionId: string;
  servers: ServerRow[];
  tools: ToolRow[];
  resources: ResourceRow[];
  prompts: PromptRow[];
}

interface GraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function parseCaps(capsJson: string): Capability[] {
  try {
    return JSON.parse(capsJson) as Capability[];
  } catch {
    return [];
  }
}

function parseSourceRole(sourceRoleJson: string): SourceRole[] {
  try {
    return JSON.parse(sourceRoleJson) as SourceRole[];
  } catch {
    return [];
  }
}

function isNonLocalhost(url: string | null): boolean {
  if (!url) return false;
  return !url.includes('localhost') && !url.includes('127.0.0.1') && !url.includes('::1');
}

function inferTrustBoundary(url: string | null): TrustBoundary {
  if (!url) return TrustBoundary.LOCAL;
  if (!isNonLocalhost(url)) return TrustBoundary.LOCAL;
  if (/github\.com|api\.github/.test(url)) {
    return TrustBoundary.CONTROLLED_SAAS;
  }
  if (/gitlab\.com|atlassian\.|slack\.com|notion\.so/.test(url)) {
    return TrustBoundary.SAAS;
  }
  return TrustBoundary.EXTERNAL;
}

function inferToolTrustBoundary(server: ServerRow, tool: ToolRow): TrustBoundary {
  const serverBoundary = inferTrustBoundary(server.url);
  if (serverBoundary !== TrustBoundary.CONTROLLED_SAAS) return serverBoundary;
  const name = tool.name.toLowerCase();
  if (
    /(issue|pull_request|pr_|review|comment|discussion|search_issues|search_pull_requests|search_code)/.test(
      name,
    )
  ) {
    return TrustBoundary.USER_CONTROLLED_SAAS;
  }
  return TrustBoundary.CONTROLLED_SAAS;
}

export function buildGraph(context: BuildContext): GraphResult {
  const { collectionId, servers, tools, resources, prompts } = context;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const edgeId = (type: string, source: string, target: string) =>
    `edge:${type}:${source}->${target}`;

  // Agent node
  const agentId = `agent:${collectionId}`;
  nodes.push({
    id: agentId,
    type: NodeType.AGENT,
    label: 'AI Agent',
    capabilities: [],
    riskScore: 0,
  });

  // Trust boundary node (one per collection if non-localhost servers exist)
  const hasRemoteServer = servers.some((s) => isNonLocalhost(s.url));
  const trustBoundaryId = `trust_boundary:${collectionId}`;
  if (hasRemoteServer) {
    nodes.push({
      id: trustBoundaryId,
      type: NodeType.TRUST_BOUNDARY,
      label: 'Network Trust Boundary',
      capabilities: [],
      riskScore: 0,
    });
  }

  // Shared external system / data source / sensitive data nodes per capability type
  const externalSystemId = `external_system:${collectionId}`;
  const dataSourceId = `data_source:${collectionId}`;
  const sensitiveDataId = `sensitive_data:${collectionId}`;

  let hasExternalSystem = false;
  let hasDataSource = false;
  let hasSensitiveData = false;

  for (const server of servers) {
    const serverNodeId = `server:${server.id}`;
    const serverTools = tools.filter((t) => t.server_id === server.id);
    const serverBoundary = inferTrustBoundary(server.url);
    const allCaps = serverTools.flatMap((t) => parseCaps(t.capabilities));
    const uniqueCaps = [...new Set(allCaps)];
    const maxRisk = serverTools.length > 0 ? Math.max(...serverTools.map((t) => t.risk_score)) : 0;

    nodes.push({
      id: serverNodeId,
      type: NodeType.MCP_SERVER,
      label: server.name,
      capabilities: uniqueCaps,
      riskScore: maxRisk,
      trustBoundary: serverBoundary,
      metadata: {
        transport: server.transport,
        url: server.url ?? undefined,
        command: server.command ?? undefined,
      },
    });

    // Agent -> Server
    edges.push({
      id: edgeId(EdgeType.CAN_CALL, agentId, serverNodeId),
      source: agentId,
      target: serverNodeId,
      type: EdgeType.CAN_CALL,
    });

    // Server crosses boundary
    if (isNonLocalhost(server.url) && hasRemoteServer) {
      edges.push({
        id: edgeId(EdgeType.CROSSES_BOUNDARY, serverNodeId, trustBoundaryId),
        source: serverNodeId,
        target: trustBoundaryId,
        type: EdgeType.CROSSES_BOUNDARY,
        metadata: {
          trustTransition: `${TrustBoundary.LOCAL} → ${serverBoundary}`,
        },
      });
    }

    // Tool nodes
    for (const tool of serverTools) {
      const toolNodeId = `tool:${tool.id}`;
      const caps = parseCaps(tool.capabilities);
      const sourceRole = parseSourceRole(tool.source_role);
      const toolBoundary = inferToolTrustBoundary(server, tool);

      nodes.push({
        id: toolNodeId,
        type: NodeType.TOOL,
        label: tool.name,
        serverId: server.id,
        capabilities: caps,
        riskScore: tool.risk_score,
        trustBoundary: toolBoundary,
        metadata: {
          description: tool.description ?? undefined,
          inputSchema: tool.input_schema
            ? (JSON.parse(tool.input_schema) as Record<string, unknown>)
            : undefined,
          sourceRole,
          isUntrusted: tool.is_untrusted === 1,
          isInstructionCapable: tool.is_instruction_capable === 1,
          contentOrigin: tool.content_origin,
          trustZone: toolBoundary,
        },
      });

      edges.push({
        id: edgeId(EdgeType.EXPOSES, serverNodeId, toolNodeId),
        source: serverNodeId,
        target: toolNodeId,
        type: EdgeType.EXPOSES,
      });

      // Tool -> trust boundary for remote servers
      if (isNonLocalhost(server.url) && hasRemoteServer) {
        edges.push({
          id: edgeId(EdgeType.CROSSES_BOUNDARY, toolNodeId, trustBoundaryId),
          source: toolNodeId,
          target: trustBoundaryId,
          type: EdgeType.CROSSES_BOUNDARY,
          metadata: {
            trustTransition: `${TrustBoundary.LOCAL} → ${toolBoundary}`,
          },
        });
      }

      // Tool capability edges
      if (
        caps.includes(Capability.SEND_HTTP) ||
        caps.includes(Capability.SEND_EXTERNAL) ||
        caps.includes(Capability.READ_REMOTE_DATA) ||
        caps.includes(Capability.QUERY_REMOTE_SYSTEM) ||
        caps.includes(Capability.MUTATE_REMOTE_STATE) ||
        caps.includes(Capability.MUTATE_ISSUE_OR_PR) ||
        caps.includes(Capability.MUTATE_REPOSITORY)
      ) {
        if (!hasExternalSystem) {
          nodes.push({
            id: externalSystemId,
            type: NodeType.EXTERNAL_SYSTEM,
            label: 'External Systems (HTTP)',
            capabilities: [],
            riskScore: 0,
          });
          hasExternalSystem = true;
        }
        edges.push({
          id: edgeId(EdgeType.CAN_SEND_TO, toolNodeId, externalSystemId),
          source: toolNodeId,
          target: externalSystemId,
          type: EdgeType.CAN_SEND_TO,
        });
      }

      if (caps.includes(Capability.READ_LOCAL_FILE) || caps.includes(Capability.WRITE_LOCAL_FILE)) {
        if (!hasDataSource) {
          nodes.push({
            id: dataSourceId,
            type: NodeType.DATA_SOURCE,
            label: 'Local File System',
            capabilities: [],
            riskScore: 0,
          });
          hasDataSource = true;
        }
        const edgeType = caps.includes(Capability.WRITE_LOCAL_FILE)
          ? EdgeType.CAN_WRITE
          : EdgeType.CAN_READ;
        edges.push({
          id: edgeId(edgeType, toolNodeId, dataSourceId),
          source: toolNodeId,
          target: dataSourceId,
          type: edgeType,
        });
      }

      if (
        caps.includes(Capability.READ_SECRET) ||
        caps.includes(Capability.READ_SECRET_HIGH) ||
        caps.includes(Capability.READ_CREDENTIAL_HIGH) ||
        caps.includes(Capability.READ_SENSITIVE_MEDIUM)
      ) {
        if (!hasSensitiveData) {
          nodes.push({
            id: sensitiveDataId,
            type: NodeType.SENSITIVE_DATA,
            label: 'Secrets / Credentials',
            capabilities: [],
            riskScore: 0,
          });
          hasSensitiveData = true;
        }
        edges.push({
          id: edgeId(EdgeType.CAN_READ, toolNodeId, sensitiveDataId),
          source: toolNodeId,
          target: sensitiveDataId,
          type: EdgeType.CAN_READ,
        });
      }

      if (caps.includes(Capability.RUN_SHELL) || caps.includes(Capability.EXECUTE_CODE)) {
        edges.push({
          id: edgeId(EdgeType.CAN_EXECUTE, toolNodeId, agentId),
          source: toolNodeId,
          target: agentId,
          type: EdgeType.CAN_EXECUTE,
        });
      }

      if (
        tool.is_instruction_capable === 1 &&
        (caps.includes(Capability.UNTRUSTED_CONTENT_EXPOSURE) ||
          caps.includes(Capability.INSTRUCTION_SOURCE))
      ) {
        const instructionSourceNodeId = `instruction_source:${tool.id}`;
        nodes.push({
          id: instructionSourceNodeId,
          type: NodeType.INSTRUCTION_SOURCE,
          label: `Instruction Source: ${tool.name}`,
          serverId: server.id,
          capabilities: [Capability.UNTRUSTED_CONTENT_EXPOSURE, Capability.INSTRUCTION_SOURCE],
          riskScore: Math.min(100, Math.max(tool.risk_score, 60)),
          trustBoundary: toolBoundary,
          metadata: {
            sourceToolId: tool.id,
            contentOrigin: tool.content_origin,
            isUntrusted: tool.is_untrusted === 1,
            trustZone: toolBoundary,
          },
        });
        edges.push({
          id: edgeId(EdgeType.RETURNS_TO_CONTEXT, toolNodeId, instructionSourceNodeId),
          source: toolNodeId,
          target: instructionSourceNodeId,
          type: EdgeType.RETURNS_TO_CONTEXT,
        });
        edges.push({
          id: edgeId(EdgeType.CARRIES_INSTRUCTION, instructionSourceNodeId, agentId),
          source: instructionSourceNodeId,
          target: agentId,
          type: EdgeType.CARRIES_INSTRUCTION,
        });
      }
    }

    // Resource nodes
    const serverResources = resources.filter((r) => r.server_id === server.id);
    for (const resource of serverResources) {
      const resourceNodeId = `resource:${resource.id}`;
      nodes.push({
        id: resourceNodeId,
        type: NodeType.RESOURCE,
        label: resource.name ?? resource.uri,
        serverId: server.id,
        capabilities: [],
        riskScore: 0,
        metadata: { uri: resource.uri, mimeType: resource.mime_type ?? undefined },
      });
      edges.push({
        id: edgeId(EdgeType.EXPOSES, serverNodeId, resourceNodeId),
        source: serverNodeId,
        target: resourceNodeId,
        type: EdgeType.EXPOSES,
      });
    }

    // Prompt nodes
    const serverPrompts = prompts.filter((p) => p.server_id === server.id);
    for (const prompt of serverPrompts) {
      const promptNodeId = `prompt:${prompt.id}`;
      nodes.push({
        id: promptNodeId,
        type: NodeType.PROMPT,
        label: prompt.name,
        serverId: server.id,
        capabilities: [],
        riskScore: 0,
        metadata: { description: prompt.description ?? undefined },
      });
      edges.push({
        id: edgeId(EdgeType.EXPOSES, serverNodeId, promptNodeId),
        source: serverNodeId,
        target: promptNodeId,
        type: EdgeType.EXPOSES,
      });
    }
  }

  // Emit confirmed sensitive trust-boundary edges for static instruction->sink chains.
  const sourceTools = tools.filter((t) => {
    const caps = parseCaps(t.capabilities);
    return (
      caps.includes(Capability.UNTRUSTED_CONTENT_EXPOSURE) ||
      caps.includes(Capability.INSTRUCTION_SOURCE)
    );
  });
  const sinkTools = tools.filter((t) => {
    const caps = parseCaps(t.capabilities);
    return (
      caps.includes(Capability.SEND_EXTERNAL) ||
      caps.includes(Capability.SEND_HTTP) ||
      caps.includes(Capability.SEND_EMAIL)
    );
  });
  for (const sourceTool of sourceTools) {
    for (const sinkTool of sinkTools) {
      if (sourceTool.server_id === sinkTool.server_id) continue;
      const sourceServer = servers.find((s) => s.id === sourceTool.server_id);
      const sinkServer = servers.find((s) => s.id === sinkTool.server_id);
      if (!sourceServer || !sinkServer) continue;
      const sourceZone = inferToolTrustBoundary(sourceServer, sourceTool);
      const sinkZone = inferToolTrustBoundary(sinkServer, sinkTool);
      const sourceSensitive =
        sourceZone === TrustBoundary.USER_CONTROLLED_SAAS || sourceZone === TrustBoundary.EXTERNAL;
      const sinkSensitive = sinkZone === TrustBoundary.LOCAL || sinkZone === TrustBoundary.INTERNAL;
      if (!sourceSensitive || !sinkSensitive) continue;
      edges.push({
        id: edgeId(
          `${EdgeType.CROSSES_BOUNDARY}:confirmed`,
          `server:${sourceServer.id}`,
          `server:${sinkServer.id}`,
        ),
        source: `server:${sourceServer.id}`,
        target: `server:${sinkServer.id}`,
        type: EdgeType.CROSSES_BOUNDARY,
        metadata: {
          trustTransition: `${sourceZone} → ${sinkZone}`,
          confirmed: true,
          sourceToolId: sourceTool.id,
          sinkToolId: sinkTool.id,
        },
      });
    }
  }

  // Deduplicate edges by id
  const edgeMap = new Map(edges.map((e) => [e.id, e]));
  return { nodes, edges: Array.from(edgeMap.values()) };
}
