import { RiskCategory, Capability } from '@iseemp/core';
import type { GraphNode, GraphEdge, Finding } from '@iseemp/core';
import type { ServerRow, ToolRow } from '@iseemp/storage';

interface FindingsContext {
  nodes: GraphNode[];
  edges: GraphEdge[];
  servers: ServerRow[];
  tools: ToolRow[];
  collectionId: string;
}

function parseCaps(capsJson: string): Capability[] {
  try {
    return JSON.parse(capsJson) as Capability[];
  } catch {
    return [];
  }
}

function isNonLocalhost(url: string | null): boolean {
  if (!url) return false;
  return !url.includes('localhost') && !url.includes('127.0.0.1') && !url.includes('::1');
}

export function runFindingsRules(context: FindingsContext): Finding[] {
  const { servers, tools, collectionId } = context;
  const findings: Finding[] = [];
  const now = new Date().toISOString();

  // Group tools by server
  const toolsByServer = new Map<string, ToolRow[]>();
  for (const tool of tools) {
    const arr = toolsByServer.get(tool.server_id) ?? [];
    arr.push(tool);
    toolsByServer.set(tool.server_id, arr);
  }

  for (const server of servers) {
    const serverTools = toolsByServer.get(server.id) ?? [];

    // Rule: UNVERIFIED_SERVER — all servers are unverified in MVP
    findings.push({
      id: `finding:${collectionId}:unverified:${server.id}`,
      collectionId,
      category: RiskCategory.UNVERIFIED_SERVER,
      severity: 'medium',
      title: `Unverified MCP server: ${server.name}`,
      description: `Server "${server.name}" has not been verified. Its tools and capabilities cannot be fully trusted.`,
      affectedNodeIds: [`server:${server.id}`],
      remediationHint: 'Review the server source, pin to a specific version, and validate its tool implementations.',
      createdAt: now,
    });

    // Rule: TRUST_BOUNDARY_CROSSING — non-localhost server
    if (isNonLocalhost(server.url)) {
      findings.push({
        id: `finding:${collectionId}:boundary:${server.id}`,
        collectionId,
        category: RiskCategory.TRUST_BOUNDARY_CROSSING,
        severity: 'high',
        title: `Remote MCP server crosses trust boundary: ${server.name}`,
        description: `Server "${server.name}" (${server.url}) is hosted remotely, meaning tool calls cross a network trust boundary. Responses could be tampered with.`,
        affectedNodeIds: [`server:${server.id}`],
        remediationHint: 'Prefer local/localhost MCP servers. For remote servers, use TLS and validate the server identity.',
        createdAt: now,
      });
    }

    for (const tool of serverTools) {
      const caps = parseCaps(tool.capabilities);

      // Rule: CODE_EXECUTION — tool has RUN_SHELL or EXECUTE_CODE
      if (caps.includes(Capability.RUN_SHELL) || caps.includes(Capability.EXECUTE_CODE)) {
        findings.push({
          id: `finding:${collectionId}:code_exec:${tool.id}`,
          collectionId,
          category: RiskCategory.CODE_EXECUTION,
          severity: 'critical',
          title: `Tool enables code/shell execution: ${tool.name}`,
          description: `Tool "${tool.name}" on server "${server.name}" can execute arbitrary code or shell commands. An AI agent with access to this tool can run any command on the host system.`,
          affectedNodeIds: [`tool:${tool.id}`, `server:${server.id}`],
          remediationHint: 'Restrict which agents can call this tool. Consider sandboxing or removing if not required.',
          createdAt: now,
        });
      }

      // Rule: SENSITIVE_DATA_EXPOSURE — tool can read secrets
      if (caps.includes(Capability.READ_SECRET)) {
        findings.push({
          id: `finding:${collectionId}:secrets:${tool.id}`,
          collectionId,
          category: RiskCategory.SENSITIVE_DATA_EXPOSURE,
          severity: 'high',
          title: `Tool can read secrets/credentials: ${tool.name}`,
          description: `Tool "${tool.name}" on server "${server.name}" can read secrets, tokens, or credentials. Exposure of these through AI context is a significant risk.`,
          affectedNodeIds: [`tool:${tool.id}`, `server:${server.id}`],
          remediationHint: 'Audit what secrets this tool can access. Use scoped credentials and never expose secrets in tool responses.',
          createdAt: now,
        });
      }

      // Rule: OVERBROAD_TOOL — 4+ capabilities
      if (caps.filter((c) => c !== Capability.UNKNOWN).length >= 4) {
        findings.push({
          id: `finding:${collectionId}:overbroad:${tool.id}`,
          collectionId,
          category: RiskCategory.OVERBROAD_TOOL,
          severity: 'high',
          title: `Overbroad tool with ${caps.length} capabilities: ${tool.name}`,
          description: `Tool "${tool.name}" on server "${server.name}" has an unusually broad set of capabilities: ${caps.join(', ')}. Overbroad tools increase attack surface.`,
          affectedNodeIds: [`tool:${tool.id}`],
          remediationHint: 'Split this tool into narrower, purpose-specific tools with minimal capability sets.',
          createdAt: now,
        });
      }
    }

    // Rule: DANGEROUS_TOOL_CHAIN — server has both READ_SECRET and SEND_HTTP tools
    const hasReadSecret = serverTools.some((t) => parseCaps(t.capabilities).includes(Capability.READ_SECRET));
    const hasSendHttp = serverTools.some((t) => parseCaps(t.capabilities).includes(Capability.SEND_HTTP));
    if (hasReadSecret && hasSendHttp) {
      findings.push({
        id: `finding:${collectionId}:chain:secret_http:${server.id}`,
        collectionId,
        category: RiskCategory.DANGEROUS_TOOL_CHAIN,
        severity: 'critical',
        title: `Dangerous tool chain: secrets + HTTP on ${server.name}`,
        description: `Server "${server.name}" exposes tools that can both READ secrets and SEND HTTP requests. A compromised agent could exfiltrate credentials to an external endpoint.`,
        affectedNodeIds: [`server:${server.id}`],
        remediationHint: 'Separate secret-reading and HTTP-sending tools onto different servers with different trust levels.',
        createdAt: now,
      });
    }

    // Rule: DATA_EXFILTRATION — server has READ_LOCAL_FILE + SEND_HTTP tools
    const hasReadFile = serverTools.some((t) => parseCaps(t.capabilities).includes(Capability.READ_LOCAL_FILE));
    if (hasReadFile && hasSendHttp) {
      findings.push({
        id: `finding:${collectionId}:chain:file_http:${server.id}`,
        collectionId,
        category: RiskCategory.DATA_EXFILTRATION,
        severity: 'critical',
        title: `Data exfiltration risk: file read + HTTP on ${server.name}`,
        description: `Server "${server.name}" can both read local files and make HTTP requests. This combination could allow exfiltrating local files to an external server.`,
        affectedNodeIds: [`server:${server.id}`],
        remediationHint: 'Restrict file-reading tools to read-only scopes and prevent their output from being passed to HTTP tools.',
        createdAt: now,
      });
    }
  }

  return findings;
}
