import { RiskCategory, Capability, LethalTrifectaStatus, TrustBoundary, Confidence } from '@iseemp/core';
import type { GraphNode, GraphEdge, Finding } from '@iseemp/core';
import type { ServerRow, ToolRow } from '@iseemp/storage';
import { applyTrifectaAnnotation, sortByTrifecta, deriveIsCrossServer } from './trifecta.js';
import { deriveCrossesTrustBoundary, deriveTrustTransition } from './trust.js';

interface FindingsContext {
  nodes: GraphNode[];
  edges: GraphEdge[];
  servers: ServerRow[];
  tools: ToolRow[];
  collectionId: string;
}

interface KnownVerifiedServerPattern {
  displayName: string;
  commandPattern?: RegExp;
  imagePattern?: RegExp;
  urlPattern?: RegExp;
}

export const KNOWN_VERIFIED_SERVER_PATTERNS: KnownVerifiedServerPattern[] = [
  {
    displayName: 'Official GitHub MCP Server',
    commandPattern: /\/usr\/local\/bin\/iseemp-github-mcp/i,
    imagePattern: /ghcr\.io\/github\/github-mcp-server/i,
  },
];

function parseCaps(capsJson: string): Capability[] {
  try {
    return JSON.parse(capsJson) as Capability[];
  } catch {
    return [];
  }
}

function parseSourceRole(sourceRoleJson: string): string[] {
  try {
    return JSON.parse(sourceRoleJson) as string[];
  } catch {
    return [];
  }
}

function isInstructionCapableTool(tool: ToolRow): boolean {
  if (tool.is_instruction_capable === 1) return true;
  const sourceRoles = parseSourceRole(tool.source_role);
  if (sourceRoles.includes('INSTRUCTION_SOURCE')) return true;
  const caps = parseCaps(tool.capabilities);
  return caps.includes(Capability.UNTRUSTED_CONTENT_EXPOSURE);
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

export function isKnownVerifiedServer(server: {
  name: string;
  url: string | null;
  command: string | null;
  args: string | null;
}): boolean {
  const command = server.command ?? '';
  const args = server.args ?? '';
  const combinedCommand = `${command} ${args}`;
  const url = server.url ?? '';

  return KNOWN_VERIFIED_SERVER_PATTERNS.some((pattern) => {
    const commandMatches = pattern.commandPattern ? pattern.commandPattern.test(command) : false;
    const imageMatches = pattern.imagePattern ? pattern.imagePattern.test(combinedCommand) : false;
    const urlMatches = pattern.urlPattern ? pattern.urlPattern.test(url) : false;
    return commandMatches || imageMatches || urlMatches;
  });
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

const EXTERNAL_COMM_CAPS: Capability[] = [...EXTERNAL_SINK_CAPS];

const PRIVATE_DATA_SOURCE_CAPS: Capability[] = [
  Capability.READ_CREDENTIAL_HIGH,
  Capability.READ_SECRET_HIGH,
  Capability.READ_SECRET,
  Capability.READ_LOCAL_FILE,
  Capability.READ_SENSITIVE_MEDIUM,
];

const UNTRUSTED_CONTENT_SOURCE_CAPS: Capability[] = [Capability.UNTRUSTED_CONTENT_EXPOSURE];

const EXEC_CAPS: Capability[] = [Capability.RUN_SHELL, Capability.EXECUTE_CODE];

const MUTATE_REMOTE_CAPS: Capability[] = [
  Capability.MUTATE_REMOTE_STATE,
  Capability.MUTATE_ISSUE_OR_PR,
  Capability.MUTATE_REPOSITORY,
];

const CROSS_SERVER_SOURCE_CAPS_PRIORITY: Capability[] = [
  Capability.READ_CREDENTIAL_HIGH,
  Capability.READ_SECRET_HIGH,
  Capability.READ_SECRET,
  Capability.READ_LOCAL_FILE,
  Capability.READ_SENSITIVE_MEDIUM,
];

const CROSS_SERVER_SINK_CAPS_PRIORITY: Capability[] = [Capability.SEND_EXTERNAL, Capability.SEND_HTTP];

function hasAny(caps: Capability[], wanted: Capability[]): boolean {
  return wanted.some((w) => caps.includes(w));
}

const SEVERITY_RANK: Record<Finding['severity'], number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};
const HIGH_PRIORITY_SUPPRESSOR_CATEGORIES = new Set<Finding['category']>([
  RiskCategory.CODE_EXECUTION,
  RiskCategory.PRIVILEGED_MUTATION,
  RiskCategory.DATA_EXFILTRATION,
  RiskCategory.SENSITIVE_DATA_EXPOSURE,
]);
const REMOTE_QUERY_SUPPRESSOR_CATEGORIES = new Set<Finding['category']>([
  RiskCategory.DATA_EXFILTRATION,
  RiskCategory.PRIVILEGED_MUTATION,
]);

function extractServerId(finding: Finding): string | undefined {
  return finding.affectedNodeIds.find((id) => id.startsWith('server:'))?.slice('server:'.length);
}

function extractToolIds(finding: Finding): string[] {
  return finding.affectedNodeIds
    .filter((id) => id.startsWith('tool:'))
    .map((id) => id.slice('tool:'.length));
}

function findingHasTool(finding: Finding, toolId: string): boolean {
  return extractToolIds(finding).includes(toolId);
}

function findingHasServer(finding: Finding, serverId: string): boolean {
  return extractServerId(finding) === serverId;
}

function findingIsProtected(finding: Finding): boolean {
  return (
    finding.tested === true ||
    typeof finding.candidatePathId === 'string' ||
    finding.trifectaComplete === true
  );
}

function isRemoteQueryFinding(finding: Finding): boolean {
  return finding.id.includes(':remote_query:') && finding.category === RiskCategory.UNVERIFIED_SERVER;
}

function isSubsumableCategory(category: Finding['category']): boolean {
  return category === RiskCategory.UNVERIFIED_SERVER || category === RiskCategory.OVERBROAD_TOOL;
}

export function deduplicateFindings(findings: Finding[]): Finding[] {
  const sorted = [...findings].sort((a, b) => a.id.localeCompare(b.id));
  const suppressedIds = new Set<string>();

  for (const target of sorted) {
    if (findingIsProtected(target)) continue;
    if (!isSubsumableCategory(target.category)) continue;

    const targetTools = extractToolIds(target);
    if (targetTools.length === 0) continue;

    for (const candidate of sorted) {
      if (candidate.id === target.id) continue;
      if (candidate.category === RiskCategory.DANGEROUS_TOOL_CHAIN) continue;
      if (HIGH_PRIORITY_SUPPRESSOR_CATEGORIES.has(candidate.category)) {
        const higherSeverity = SEVERITY_RANK[candidate.severity] > SEVERITY_RANK[target.severity];
        if (!higherSeverity) continue;
        if (targetTools.some((toolId) => findingHasTool(candidate, toolId))) {
          suppressedIds.add(target.id);
          break;
        }
      }
    }
  }

  for (const target of sorted) {
    if (suppressedIds.has(target.id) || findingIsProtected(target) || !isRemoteQueryFinding(target)) continue;
    const serverId = extractServerId(target);
    const toolIds = extractToolIds(target);
    if (!serverId || toolIds.length === 0) continue;

    const hasHigherSignal = sorted.some((candidate) => {
      if (candidate.id === target.id) return false;
      if (!REMOTE_QUERY_SUPPRESSOR_CATEGORIES.has(candidate.category)) {
        return false;
      }
      if (!findingHasServer(candidate, serverId)) return false;
      return toolIds.some((toolId) => findingHasTool(candidate, toolId));
    });
    if (hasHigherSignal) suppressedIds.add(target.id);
  }

  const dedupedByCompoundKey = new Map<string, Finding>();
  const preserved: Finding[] = [];
  for (const finding of sorted) {
    if (suppressedIds.has(finding.id)) continue;
    if (findingIsProtected(finding)) {
      preserved.push(finding);
      continue;
    }

    const serverId = extractServerId(finding) ?? '';
    const crossServerKey =
      finding.isCrossServer === true
        ? `${finding.sourceServerId ?? 'unknown-source'}->${finding.sinkServerId ?? 'unknown-sink'}`
        : undefined;
    const dedupeServerKey = crossServerKey ?? serverId;
    const toolIdsKey = extractToolIds(finding).sort().join(',');
    const key = `${finding.collectionId}|${finding.category}|${dedupeServerKey}|${toolIdsKey}`;
    const existing = dedupedByCompoundKey.get(key);
    if (!existing) {
      dedupedByCompoundKey.set(key, finding);
      continue;
    }
    const newRank = SEVERITY_RANK[finding.severity];
    const oldRank = SEVERITY_RANK[existing.severity];
    if (newRank > oldRank) {
      dedupedByCompoundKey.set(key, finding);
      continue;
    }
    if (newRank === oldRank && finding.id.localeCompare(existing.id) < 0) {
      dedupedByCompoundKey.set(key, finding);
    }
  }

  return [...dedupedByCompoundKey.values(), ...preserved].sort((a, b) => a.id.localeCompare(b.id));
}

function makeCandidatePathId(parts: {
  category: string;
  sourceToolId?: string;
  sinkToolId?: string;
  serverId: string;
  sinkServerId?: string;
  pathSummary: string;
}): string {
  const cleanedPath = parts.pathSummary.replace(/\s+/g, ' ').trim();
  return [
    parts.category,
    parts.sourceToolId ?? 'none',
    parts.sinkToolId ?? 'none',
    parts.serverId,
    parts.sinkServerId ?? parts.serverId,
    cleanedPath,
  ].join('|');
}

function pickToolByNameOrFirst(tools: ToolRow[], nameIncludes: string): ToolRow | undefined {
  return tools.find((t) => t.name.includes(nameIncludes)) ?? tools[0];
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
    const hasServerLowMetadata = serverCapsArr.includes(Capability.READ_METADATA_LOW);
    const hasServerLocalFile = serverCapsArr.includes(Capability.READ_LOCAL_FILE);
    const hasServerExternalSink = hasAny(serverCapsArr, EXTERNAL_SINK_CAPS);
    const hasServerExternalCommunication = hasAny(serverCapsArr, EXTERNAL_COMM_CAPS);
    const hasServerPrivateData = hasAny(serverCapsArr, PRIVATE_DATA_SOURCE_CAPS);
    const hasServerUntrustedContent =
      hasAny(serverCapsArr, UNTRUSTED_CONTENT_SOURCE_CAPS) ||
      serverTools.some(isInstructionCapableTool);
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

    const knownVerified = isKnownVerifiedServer(server);
    findings.push({
      id: `finding:${collectionId}:unverified:${server.id}`,
      collectionId,
      category: RiskCategory.UNVERIFIED_SERVER,
      severity: knownVerified ? 'low' : unverifiedSeverity,
      title: `Unverified MCP server: ${server.name}`,
      description: knownVerified
        ? `Server "${server.name}" is matched by known identity pattern to an official MCP distribution, but this is not cryptographic verification and should still be reviewed.`
        : `Server "${server.name}" has not been verified. Its tools and capabilities cannot be fully trusted.`,
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
          pathSummary: 'AGENT -> MUTATE_REMOTE_STATE',
          candidatePathId: makeCandidatePathId({
            category: RiskCategory.PRIVILEGED_MUTATION,
            sourceToolId: tool.id,
            serverId: server.id,
            pathSummary: 'AGENT -> MUTATE_REMOTE_STATE',
          }),
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
        lethalTrifectaStatus:
          hasServerPrivateData && hasServerUntrustedContent && hasServerExternalCommunication
            ? LethalTrifectaStatus.POSSIBLE
            : LethalTrifectaStatus.NONE,
        candidatePathId:
          sourceTools[0] && pickToolByNameOrFirst(sinkTools, 'send_to_mock_sink')
            ? makeCandidatePathId({
                category: RiskCategory.DATA_EXFILTRATION,
                sourceToolId: sourceTools[0].id,
                sinkToolId: pickToolByNameOrFirst(sinkTools, 'send_to_mock_sink')!.id,
                serverId: server.id,
                pathSummary: 'READ_SECRET_HIGH -> MODEL_CONTEXT -> SEND_EXTERNAL',
              })
            : undefined,
      });
    }

    // -------- Sensitive metadata + external send --------
    if (hasServerSensitiveMedium && hasServerExternalSink && !hasServerHighSecret) {
      const sourceTools = serverTools.filter((t) =>
        parseCaps(t.capabilities).includes(Capability.READ_SENSITIVE_MEDIUM),
      );
      const sinkTools = serverTools.filter((t) =>
        hasAny(parseCaps(t.capabilities), EXTERNAL_SINK_CAPS),
      );
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
        lethalTrifectaStatus:
          hasServerPrivateData && hasServerUntrustedContent && hasServerExternalCommunication
            ? LethalTrifectaStatus.POSSIBLE
            : LethalTrifectaStatus.NONE,
        candidatePathId:
          sourceTools[0] && sinkTools[0]
            ? makeCandidatePathId({
                category: RiskCategory.DATA_EXFILTRATION,
                sourceToolId: sourceTools[0].id,
                sinkToolId: sinkTools[0].id,
                serverId: server.id,
                pathSummary: 'READ_SENSITIVE_MEDIUM -> MODEL_CONTEXT -> SEND_EXTERNAL',
              })
            : undefined,
      });
    }

    // -------- Low-sensitivity metadata + external send --------
    if (hasServerLowMetadata && hasServerExternalSink) {
      const sourceTools = serverTools.filter((t) =>
        parseCaps(t.capabilities).includes(Capability.READ_METADATA_LOW),
      );
      const sinkTools = serverTools.filter((t) =>
        hasAny(parseCaps(t.capabilities), EXTERNAL_SINK_CAPS),
      );
      findings.push({
        id: `finding:${collectionId}:chain:metadata_low_external:${server.id}`,
        collectionId,
        category: RiskCategory.DATA_EXFILTRATION,
        severity: 'low',
        title: `Low-sensitivity metadata can reach external-send tools on ${server.name}`,
        description: `Server "${server.name}" exposes low-sensitivity metadata reads and external-send tools. This path is lower risk than secret/sensitive flows but is still relevant for deterministic path testing and trust-boundary review.`,
        affectedNodeIds: [`server:${server.id}`],
        remediationHint:
          'Prefer explicit allow-lists for outbound destinations and avoid unnecessary metadata forwarding.',
        createdAt: now,
        confidence: Confidence.LOW,
        staticPossible: true,
        observed: false,
        tested: false,
        sourceCapabilities: [Capability.READ_METADATA_LOW],
        sinkCapabilities: EXTERNAL_SINK_CAPS.filter((c) => serverCapsArr.includes(c)),
        boundaryCrossed: boundary,
        pathSummary: `READ_METADATA_LOW -> MODEL_CONTEXT -> SEND_EXTERNAL (${boundary})`,
        lethalTrifectaStatus:
          hasServerPrivateData && hasServerUntrustedContent && hasServerExternalCommunication
            ? LethalTrifectaStatus.POSSIBLE
            : LethalTrifectaStatus.NONE,
        candidatePathId:
          sourceTools[0] && pickToolByNameOrFirst(sinkTools, 'blocked_send')
            ? makeCandidatePathId({
                category: RiskCategory.DATA_EXFILTRATION,
                sourceToolId: sourceTools[0].id,
                sinkToolId: pickToolByNameOrFirst(sinkTools, 'blocked_send')!.id,
                serverId: server.id,
                pathSummary: 'READ_METADATA_LOW -> MODEL_CONTEXT -> SEND_EXTERNAL',
              })
            : undefined,
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
        lethalTrifectaStatus:
          hasServerPrivateData && hasServerUntrustedContent && hasServerExternalCommunication
            ? LethalTrifectaStatus.POSSIBLE
            : LethalTrifectaStatus.NONE,
      });
    }

    if (hasServerPrivateData && hasServerUntrustedContent && hasServerExternalCommunication) {
      const instructionTools = serverTools.filter(isInstructionCapableTool);
      const sourceTools = serverTools.filter((t) =>
        hasAny(parseCaps(t.capabilities), PRIVATE_DATA_SOURCE_CAPS),
      );
      const sinkTools = serverTools.filter((t) =>
        hasAny(parseCaps(t.capabilities), EXTERNAL_COMM_CAPS),
      );
      const instructionTool = instructionTools[0];
      const sourceTool = sourceTools[0];
      const sinkTool = sinkTools[0];

      findings.push({
        id: `finding:${collectionId}:prompt_injection:${server.id}`,
        collectionId,
        category: RiskCategory.PROMPT_INJECTION,
        severity: hasServerHighSecret ? 'high' : 'medium',
        title: `Prompt-injection candidate chain on ${server.name}`,
        description: `Server "${server.name}" exposes private-data access, instruction-bearing untrusted content, and external communication capabilities. This combination is a prompt-injection exploitability candidate and should be tested with deterministic canaries.`,
        affectedNodeIds: [
          `server:${server.id}`,
          ...(instructionTools.map((t) => `tool:${t.id}`)),
          ...(sourceTools.map((t) => `tool:${t.id}`)),
          ...(sinkTools.map((t) => `tool:${t.id}`)),
        ],
        remediationHint:
          'Isolate instruction-bearing tools from sensitive reads and external sinks, then run prompt-injection canary tests.',
        createdAt: now,
        confidence: Confidence.MEDIUM,
        staticPossible: true,
        observed: false,
        tested: false,
        sourceCapabilities: PRIVATE_DATA_SOURCE_CAPS.filter((c) => serverCapsArr.includes(c)),
        sinkCapabilities: EXTERNAL_COMM_CAPS.filter((c) => serverCapsArr.includes(c)),
        boundaryCrossed: boundary,
        pathSummary: `INSTRUCTION_SOURCE -> MODEL_CONTEXT -> PRIVATE_DATA -> SEND_EXTERNAL (${boundary})`,
        lethalTrifectaStatus: LethalTrifectaStatus.POSSIBLE,
        candidatePathId:
          instructionTool && sourceTool && sinkTool
            ? makeCandidatePathId({
                category: RiskCategory.PROMPT_INJECTION,
                sourceToolId: instructionTool.id,
                sinkToolId: sinkTool.id,
                serverId: server.id,
                pathSummary: `INSTRUCTION_SOURCE -> MODEL_CONTEXT -> PRIVATE_DATA -> SEND_EXTERNAL (${boundary})`,
              })
            : undefined,
      });
    }
  }

  const crossServerSources = servers
    .map((server) => {
      const serverTools = toolsByServer.get(server.id) ?? [];
      const sourceTools = serverTools.filter((tool) =>
        hasAny(parseCaps(tool.capabilities), CROSS_SERVER_SOURCE_CAPS_PRIORITY),
      );
      if (sourceTools.length === 0) return null;
      const sourceCaps = CROSS_SERVER_SOURCE_CAPS_PRIORITY.filter((cap) =>
        sourceTools.some((tool) => parseCaps(tool.capabilities).includes(cap)),
      );
      if (sourceCaps.length === 0) return null;
      return { server, sourceTools, sourceCaps };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);

  const crossServerSinks = servers
    .map((server) => {
      const serverTools = toolsByServer.get(server.id) ?? [];
      const sinkTools = serverTools.filter((tool) =>
        hasAny(parseCaps(tool.capabilities), CROSS_SERVER_SINK_CAPS_PRIORITY),
      );
      if (sinkTools.length === 0) return null;
      const sinkCaps = CROSS_SERVER_SINK_CAPS_PRIORITY.filter((cap) =>
        sinkTools.some((tool) => parseCaps(tool.capabilities).includes(cap)),
      );
      if (sinkCaps.length === 0) return null;
      return { server, sinkTools, sinkCaps };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);

  for (const sourceCandidate of crossServerSources) {
    for (const sinkCandidate of crossServerSinks) {
      if (sourceCandidate.server.id === sinkCandidate.server.id) continue;

      const sourceCapRepresentative = sourceCandidate.sourceCaps[0]!;
      const sinkCapRepresentative = sinkCandidate.sinkCaps[0]!;
      const sourceToolRepresentative = sourceCandidate.sourceTools.find((tool) =>
        parseCaps(tool.capabilities).includes(sourceCapRepresentative),
      );
      const sinkToolRepresentative = sinkCandidate.sinkTools.find((tool) =>
        parseCaps(tool.capabilities).includes(sinkCapRepresentative),
      );
      const sinkBoundary = inferServerTrustBoundary(sinkCandidate.server);
      const trust = deriveTrustTransition(sourceCandidate.server.id, sinkCandidate.server.id);
      const isHighSensitivitySource =
        sourceCapRepresentative === Capability.READ_CREDENTIAL_HIGH ||
        sourceCapRepresentative === Capability.READ_SECRET_HIGH ||
        sourceCapRepresentative === Capability.READ_SECRET;

      const pathSummary = `${sourceCapRepresentative} -> MODEL_CONTEXT -> ${sinkCapRepresentative} (cross-server: ${sourceCandidate.server.name} → ${sinkCandidate.server.name})`;
      const sourceServerCapsArr = Array.from(
        new Set(
          (toolsByServer.get(sourceCandidate.server.id) ?? []).flatMap((tool) => parseCaps(tool.capabilities)),
        ),
      );
      const sinkServerCapsArr = Array.from(
        new Set(
          (toolsByServer.get(sinkCandidate.server.id) ?? []).flatMap((tool) => parseCaps(tool.capabilities)),
        ),
      );
      const lethalCandidate =
        hasAny(sourceServerCapsArr, PRIVATE_DATA_SOURCE_CAPS) &&
        hasAny(sourceServerCapsArr, UNTRUSTED_CONTENT_SOURCE_CAPS) &&
        hasAny(sinkServerCapsArr, EXTERNAL_COMM_CAPS);
      findings.push({
        id: `finding:${collectionId}:chain:cross_server:${sourceCandidate.server.id}:${sinkCandidate.server.id}`,
        collectionId,
        category: RiskCategory.DATA_EXFILTRATION,
        severity: isHighSensitivitySource ? 'high' : 'medium',
        title: `Cross-server path candidate: ${sourceCandidate.server.name} → ${sinkCandidate.server.name}`,
        description: `Source capability on "${sourceCandidate.server.name}" and external-send capability on "${sinkCandidate.server.name}" form a deterministic cross-server candidate path through MODEL_CONTEXT. This is not a confirmed execution chain.`,
        affectedNodeIds: [
          `server:${sourceCandidate.server.id}`,
          `server:${sinkCandidate.server.id}`,
          ...sourceCandidate.sourceTools.map((tool) => `tool:${tool.id}`),
          ...sinkCandidate.sinkTools.map((tool) => `tool:${tool.id}`),
        ],
        remediationHint:
          'Keep source-reading and external-send tools isolated across trust boundaries and require deterministic validation before treating this as exploitable.',
        createdAt: now,
        confidence: Confidence.LOW,
        staticPossible: true,
        observed: false,
        tested: false,
        sourceCapabilities: sourceCandidate.sourceCaps,
        sinkCapabilities: sinkCandidate.sinkCaps,
        boundaryCrossed: sinkBoundary,
        pathSummary,
        lethalTrifectaStatus: lethalCandidate
          ? LethalTrifectaStatus.POSSIBLE
          : LethalTrifectaStatus.NONE,
        candidatePathId:
          sourceToolRepresentative && sinkToolRepresentative
            ? makeCandidatePathId({
                category: RiskCategory.DATA_EXFILTRATION,
                sourceToolId: sourceToolRepresentative.id,
                sinkToolId: sinkToolRepresentative.id,
                serverId: sourceCandidate.server.id,
                sinkServerId: sinkCandidate.server.id,
                pathSummary,
              })
            : undefined,
        isCrossServer: deriveIsCrossServer({
          sourceServerId: sourceCandidate.server.id,
          sinkServerId: sinkCandidate.server.id,
        }),
        sourceServerId: sourceCandidate.server.id,
        sinkServerId: sinkCandidate.server.id,
        crossesTrustBoundary: deriveCrossesTrustBoundary(
          sourceCandidate.server.id,
          sinkCandidate.server.id,
        ),
        trustTransition: trust.transition,
      });
    }
  }

  const annotated = applyTrifectaAnnotation(findings);
  const deduped = deduplicateFindings(annotated);
  return sortByTrifecta(deduped);
}
