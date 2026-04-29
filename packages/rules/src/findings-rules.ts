import { RiskCategory, Capability, TrustBoundary, Confidence } from '@iseemp/core';
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

/** Determine the trust boundary for a server based on transport and URL. */
export function inferServerTrustBoundary(server: { url: string | null; transport?: string }): TrustBoundary {
  if (!server.url) return TrustBoundary.LOCAL;
  if (!isNonLocalhost(server.url)) return TrustBoundary.LOCAL;
  if (/github\.com|api\.github|gitlab\.com|atlassian\.|slack\.com|notion\.so/.test(server.url)) {
    return TrustBoundary.SAAS;
  }
  return TrustBoundary.EXTERNAL;
}

/** Capabilities considered "high secret" for severity scoring. */
const HIGH_SECRET_CAPS: Capability[] = [
  Capability.READ_CREDENTIAL_HIGH,
  Capability.READ_SECRET_HIGH,
  Capability.READ_SECRET, // legacy alias
];

/** Capabilities that exfiltrate data to outside the trust boundary. */
const EXTERNAL_SINK_CAPS: Capability[] = [
  Capability.SEND_EXTERNAL,
  Capability.SEND_HTTP,
  Capability.SEND_EMAIL,
];

const EXEC_CAPS: Capability[] = [Capability.RUN_SHELL, Capability.EXECUTE_CODE];

const MUTATE_REMOTE_CAPS: Capability[] = [
  Capability.MUTATE_REMOTE_STATE,
  Capability.MUTATE_ISSUE_OR_PR,
  Capability.MUTATE_REPOSITORY,
];

function hasAny(caps: Capability[], wanted: Capability[]): boolean {
  return wanted.some((w) => caps.includes(w));
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
    const boundary = inferServerTrustBoundary(server);
    const isExternalBoundary =
      boundary === TrustBoundary.EXTERNAL ||
      boundary === TrustBoundary.SAAS ||
      boundary === TrustBoundary.UNKNOWN;

    // Aggregate server-level capability presence
    const allCaps = new Set<Capability>();
    for (const t of serverTools) for (const c of parseCaps(t.capabilities)) allCaps.add(c);
    const serverCapsArr = Array.from(allCaps);
    const hasServerHighSecret = hasAny(serverCapsArr, HIGH_SECRET_CAPS);
    const hasServerSensitiveMedium = serverCapsArr.includes(Capability.READ_SENSITIVE_MEDIUM);
    const hasServerLocalFile = serverCapsArr.includes(Capability.READ_LOCAL_FILE);
    const hasServerExternalSink = hasAny(serverCapsArr, EXTERNAL_SINK_CAPS);
    const hasServerExec = hasAny(serverCapsArr, EXEC_CAPS);
    const hasServerLowOnly =
      serverCapsArr.length > 0 &&
      serverCapsArr.every(
        (c) =>
          c === Capability.READ_METADATA_LOW ||
          c === Capability.QUERY_REMOTE_SYSTEM ||
          c === Capability.READ_REMOTE_DATA ||
          c === Capability.UNKNOWN,
      );

    // Rule: UNVERIFIED_SERVER. Severity depends on what the server can do.
    let unverifiedSeverity: Finding['severity'] = 'low';
    if (hasServerExec || hasServerHighSecret) unverifiedSeverity = 'medium';
    else if (hasServerSensitiveMedium || hasServerLocalFile || hasAny(serverCapsArr, MUTATE_REMOTE_CAPS))
      unverifiedSeverity = 'medium';
    else if (hasServerLowOnly) unverifiedSeverity = 'low';
    else unverifiedSeverity = 'low';

    findings.push({
      id: `finding:${collectionId}:unverified:${server.id}`,
      collectionId,
      category: RiskCategory.UNVERIFIED_SERVER,
      severity: unverifiedSeverity,
      title: `Unverified MCP server: ${server.name}`,
      description: `Server "${server.name}" has not been verified. Its tools and capabilities cannot be fully trusted.`,
      affectedNodeIds: [`server:${server.id}`],
      remediationHint: 'Review the server source, pin to a specific version, and validate its tool implementations.',
      createdAt: now,
      confidence: Confidence.MEDIUM,
      staticPossible: true,
      observed: false,
      tested: false,
      boundaryCrossed: boundary,
    });

    // Rule: TRUST_BOUNDARY_CROSSING — non-localhost server
    if (isNonLocalhost(server.url)) {
      findings.push({
        id: `finding:${collectionId}:boundary:${server.id}`,
        collectionId,
        category: RiskCategory.TRUST_BOUNDARY_CROSSING,
        severity: hasServerHighSecret || hasServerExec ? 'high' : 'medium',
        title: `Remote MCP server crosses trust boundary: ${server.name}`,
        description: `Server "${server.name}" (${server.url}) is hosted remotely (${boundary}), meaning tool calls cross a network trust boundary. Responses could be tampered with.`,
        affectedNodeIds: [`server:${server.id}`],
        remediationHint: 'Prefer local/localhost MCP servers. For remote servers, use TLS and validate the server identity.',
        createdAt: now,
        confidence: Confidence.HIGH,
        staticPossible: true,
        observed: false,
        tested: false,
        boundaryCrossed: boundary,
      });
    }

    for (const tool of serverTools) {
      const caps = parseCaps(tool.capabilities);

      // -------- Code/shell execution (precise) --------
      if (caps.includes(Capability.RUN_SHELL) || caps.includes(Capability.EXECUTE_CODE)) {
        const isShell = caps.includes(Capability.RUN_SHELL);
        const sevBase: Finding['severity'] =
          (isExternalBoundary && hasServerExternalSink) || hasServerHighSecret ? 'critical' : 'high';
        findings.push({
          id: `finding:${collectionId}:code_exec:${tool.id}`,
          collectionId,
          category: RiskCategory.CODE_EXECUTION,
          severity: sevBase,
          title: `${isShell ? 'Shell' : 'Code'} execution tool exposed to agent: ${tool.name}`,
          description: `Tool "${tool.name}" on server "${server.name}" can ${
            isShell ? 'execute shell commands' : 'evaluate code in an interpreter'
          }. An AI agent with access to this tool may be able to run untrusted ${
            isShell ? 'commands' : 'code'
          } on the host or sandbox.`,
          affectedNodeIds: [`tool:${tool.id}`, `server:${server.id}`],
          remediationHint:
            'Restrict which agents can call this tool. Sandbox it, allow-list commands, or remove if not required.',
          createdAt: now,
          confidence: Confidence.HIGH,
          staticPossible: true,
          observed: false,
          tested: false,
          sourceCapabilities: caps.filter((c) => EXEC_CAPS.includes(c)),
          sinkCapabilities: [],
          boundaryCrossed: boundary,
          pathSummary: `AGENT -> ${isShell ? 'RUN_SHELL' : 'EXECUTE_CODE'}`,
        });
      }

      // -------- High-sensitivity reads (secrets/credentials) --------
      if (hasAny(caps, HIGH_SECRET_CAPS)) {
        findings.push({
          id: `finding:${collectionId}:secrets_high:${tool.id}`,
          collectionId,
          category: RiskCategory.SENSITIVE_DATA_EXPOSURE,
          severity: 'high',
          title: `Credential/secret read tool exposed to agent: ${tool.name}`,
          description: `Tool "${tool.name}" on server "${server.name}" can read secrets, tokens, or credentials. Exposure of these through AI context is a significant risk.`,
          affectedNodeIds: [`tool:${tool.id}`, `server:${server.id}`],
          remediationHint:
            'Audit what secrets this tool can access. Use scoped credentials and never expose secrets in tool responses.',
          createdAt: now,
          confidence: Confidence.HIGH,
          staticPossible: true,
          observed: false,
          tested: false,
          sourceCapabilities: caps.filter((c) => HIGH_SECRET_CAPS.includes(c)),
          sinkCapabilities: [],
          boundaryCrossed: boundary,
        });
      }

      // -------- Medium-sensitivity reads (org/team metadata) --------
      if (caps.includes(Capability.READ_SENSITIVE_MEDIUM)) {
        findings.push({
          id: `finding:${collectionId}:sensitive_medium:${tool.id}`,
          collectionId,
          category: RiskCategory.SENSITIVE_DATA_EXPOSURE,
          severity: 'medium',
          title: `Sensitive organisation metadata exposed to agent: ${tool.name}`,
          description: `Tool "${tool.name}" on server "${server.name}" can read sensitive organisation, team, or membership metadata. This data may be private and should not be passed into untrusted contexts.`,
          affectedNodeIds: [`tool:${tool.id}`, `server:${server.id}`],
          remediationHint:
            'Restrict which agents can call this tool. Avoid passing the response into prompts that may be exfiltrated.',
          createdAt: now,
          confidence: Confidence.MEDIUM,
          staticPossible: true,
          observed: false,
          tested: false,
          sourceCapabilities: [Capability.READ_SENSITIVE_MEDIUM],
          sinkCapabilities: [],
          boundaryCrossed: boundary,
        });
      }

      // -------- Remote state mutation tools (PR/issue/comment write) --------
      if (
        hasAny(caps, MUTATE_REMOTE_CAPS) &&
        !caps.includes(Capability.RUN_SHELL) &&
        !caps.includes(Capability.EXECUTE_CODE)
      ) {
        const sev: Finding['severity'] = 'medium';
        findings.push({
          id: `finding:${collectionId}:mutate_remote:${tool.id}`,
          collectionId,
          category: RiskCategory.PRIVILEGED_MUTATION,
          severity: sev,
          title: `Remote state mutation tool exposed to agent: ${tool.name}`,
          description: `Tool "${tool.name}" on server "${server.name}" can mutate state on a remote ${
            boundary === TrustBoundary.SAAS ? 'SaaS service' : 'system'
          }. An agent could create, modify, or delete records (issues, PRs, comments, repository contents).`,
          affectedNodeIds: [`tool:${tool.id}`, `server:${server.id}`],
          remediationHint:
            'Scope tokens to the minimum required. Consider requiring explicit human approval for mutating tools.',
          createdAt: now,
          confidence: Confidence.HIGH,
          staticPossible: true,
          observed: false,
          tested: false,
          sourceCapabilities: caps.filter((c) => MUTATE_REMOTE_CAPS.includes(c)),
          sinkCapabilities: [],
          boundaryCrossed: boundary,
        });
      }

      // -------- Remote query / search tools --------
      if (
        caps.includes(Capability.QUERY_REMOTE_SYSTEM) &&
        !hasAny(caps, EXEC_CAPS) &&
        !hasAny(caps, MUTATE_REMOTE_CAPS) &&
        !hasAny(caps, HIGH_SECRET_CAPS) &&
        !caps.includes(Capability.READ_SENSITIVE_MEDIUM)
      ) {
        findings.push({
          id: `finding:${collectionId}:remote_query:${tool.id}`,
          collectionId,
          category: RiskCategory.UNVERIFIED_SERVER,
          severity: 'low',
          title: `Remote query tool exposed to agent: ${tool.name}`,
          description: `Tool "${tool.name}" on server "${server.name}" performs read-only queries against a remote system. Low direct risk, but its responses may influence agent behaviour and should not be implicitly trusted.`,
          affectedNodeIds: [`tool:${tool.id}`, `server:${server.id}`],
          remediationHint:
            'Treat remote query results as untrusted input. Sanitise before passing into prompts.',
          createdAt: now,
          confidence: Confidence.MEDIUM,
          staticPossible: true,
          observed: false,
          tested: false,
          sourceCapabilities: [Capability.QUERY_REMOTE_SYSTEM],
          sinkCapabilities: [],
          boundaryCrossed: boundary,
        });
      }

      // -------- OVERBROAD_TOOL — 4+ meaningful capabilities --------
      const meaningfulCaps = caps.filter((c) => c !== Capability.UNKNOWN);
      if (meaningfulCaps.length >= 4) {
        findings.push({
          id: `finding:${collectionId}:overbroad:${tool.id}`,
          collectionId,
          category: RiskCategory.OVERBROAD_TOOL,
          severity: 'medium',
          title: `Overbroad tool with ${meaningfulCaps.length} capabilities: ${tool.name}`,
          description: `Tool "${tool.name}" on server "${server.name}" has an unusually broad set of capabilities: ${meaningfulCaps.join(
            ', ',
          )}. Overbroad tools increase attack surface.`,
          affectedNodeIds: [`tool:${tool.id}`],
          remediationHint: 'Split this tool into narrower, purpose-specific tools with minimal capability sets.',
          createdAt: now,
          confidence: Confidence.MEDIUM,
          staticPossible: true,
          observed: false,
          tested: false,
          boundaryCrossed: boundary,
        });
      }
    }

    // -------- DANGEROUS_TOOL_CHAIN: high-secret + external send (data movement path) --------
    if (hasServerHighSecret && hasServerExternalSink) {
      const sourceTools = serverTools.filter((t) => hasAny(parseCaps(t.capabilities), HIGH_SECRET_CAPS));
      const sinkTools = serverTools.filter((t) =>
        hasAny(parseCaps(t.capabilities), EXTERNAL_SINK_CAPS),
      );
      findings.push({
        id: `finding:${collectionId}:chain:secret_external:${server.id}`,
        collectionId,
        category: RiskCategory.DATA_EXFILTRATION,
        severity: isExternalBoundary ? 'critical' : 'high',
        title: `Potential credential exfiltration path on ${server.name}`,
        description: `Server "${server.name}" exposes both credential-reading tools and external-send tools. A compromised agent could move secrets across the ${boundary} trust boundary.`,
        affectedNodeIds: [
          `server:${server.id}`,
          ...sourceTools.map((t) => `tool:${t.id}`),
          ...sinkTools.map((t) => `tool:${t.id}`),
        ],
        remediationHint:
          'Separate secret-reading and external-sending tools onto different servers with different trust levels.',
        createdAt: now,
        confidence: Confidence.MEDIUM,
        staticPossible: true,
        observed: false,
        tested: false,
        sourceCapabilities: HIGH_SECRET_CAPS.filter((c) => serverCapsArr.includes(c)),
        sinkCapabilities: EXTERNAL_SINK_CAPS.filter((c) => serverCapsArr.includes(c)),
        boundaryCrossed: boundary,
        pathSummary: `READ_SECRET_HIGH -> MODEL_CONTEXT -> SEND_EXTERNAL (${boundary})`,
      });
    }

    // -------- Sensitive metadata + external send --------
    if (hasServerSensitiveMedium && hasServerExternalSink && !hasServerHighSecret) {
      findings.push({
        id: `finding:${collectionId}:chain:sensitive_external:${server.id}`,
        collectionId,
        category: RiskCategory.DATA_EXFILTRATION,
        severity: 'medium',
        title: `Potential data movement path: sensitive metadata can reach external HTTP-capable tools on ${server.name}`,
        description: `Server "${server.name}" exposes both sensitive-metadata tools and external-send tools. Sensitive organisation/team data could be passed via the agent context to external destinations.`,
        affectedNodeIds: [`server:${server.id}`],
        remediationHint:
          'Treat sensitive metadata responses as untrusted-output sources; avoid feeding them into tools that send data externally.',
        createdAt: now,
        confidence: Confidence.LOW,
        staticPossible: true,
        observed: false,
        tested: false,
        sourceCapabilities: [Capability.READ_SENSITIVE_MEDIUM],
        sinkCapabilities: EXTERNAL_SINK_CAPS.filter((c) => serverCapsArr.includes(c)),
        boundaryCrossed: boundary,
        pathSummary: `READ_SENSITIVE_MEDIUM -> MODEL_CONTEXT -> SEND_EXTERNAL (${boundary})`,
      });
    }

    // -------- Local file + external send (classic data exfiltration) --------
    if (hasServerLocalFile && hasServerExternalSink) {
      findings.push({
        id: `finding:${collectionId}:chain:file_external:${server.id}`,
        collectionId,
        category: RiskCategory.DATA_EXFILTRATION,
        severity: 'high',
        title: `Local file exfiltration path on ${server.name}`,
        description: `Server "${server.name}" can both read local files and make external-send requests. This combination could allow exfiltrating local files across the ${boundary} trust boundary.`,
        affectedNodeIds: [`server:${server.id}`],
        remediationHint: 'Restrict file-reading tools to read-only scopes and prevent their output from being passed to external-send tools.',
        createdAt: now,
        confidence: Confidence.MEDIUM,
        staticPossible: true,
        observed: false,
        tested: false,
        sourceCapabilities: [Capability.READ_LOCAL_FILE],
        sinkCapabilities: EXTERNAL_SINK_CAPS.filter((c) => serverCapsArr.includes(c)),
        boundaryCrossed: boundary,
        pathSummary: `READ_LOCAL_FILE -> MODEL_CONTEXT -> SEND_EXTERNAL (${boundary})`,
      });
    }
  }

  return findings;
}
