import { TrustBoundary } from '@iseemp/core';

export const TrustZone = {
  LOCAL: 'LOCAL',
  INTERNAL: 'INTERNAL',
  CONTROLLED_SAAS: 'CONTROLLED_SAAS',
  USER_CONTROLLED_SAAS: 'USER_CONTROLLED_SAAS',
  EXTERNAL: 'EXTERNAL',
  UNKNOWN: 'UNKNOWN',
} as const;

export type TrustZone = (typeof TrustZone)[keyof typeof TrustZone];

export const SERVER_TRUST_MAP: Record<string, TrustZone> = {
  filesystem: TrustZone.LOCAL,
  'dv-mcp': TrustZone.LOCAL,
  fetch: TrustZone.EXTERNAL,
  github: TrustZone.CONTROLLED_SAAS,
};

export interface TrustTransition {
  sourceTrust?: TrustZone;
  sinkTrust?: TrustZone;
  transition?: string;
}

function normalizeServerKey(serverId: string): string {
  const lower = serverId.toLowerCase();
  if (lower in SERVER_TRUST_MAP) return lower;
  const parts = lower.split(':');
  const tail = parts[parts.length - 1] ?? lower;
  return tail in SERVER_TRUST_MAP ? tail : lower;
}

const GITHUB_USER_CONTROLLED_TOOL_RE =
  /(issue|pull_request|pr_|review|comment|discussion|search_issues|search_pull_requests|search_code)/i;

const GITHUB_CONTROLLED_TOOL_RE =
  /(get_file_contents|list_commits|get_commit|list_branches|list_tags|get_tag|list_releases|get_release|get_latest_release)/i;

export function getServerTrust(serverId?: string, toolName?: string): TrustZone | undefined {
  if (!serverId) return undefined;
  const key = normalizeServerKey(serverId);
  const base = SERVER_TRUST_MAP[key];
  if (!base) return undefined;
  if (key !== 'github') return base;
  if (!toolName) return base;
  if (GITHUB_USER_CONTROLLED_TOOL_RE.test(toolName)) return TrustZone.USER_CONTROLLED_SAAS;
  if (GITHUB_CONTROLLED_TOOL_RE.test(toolName)) return TrustZone.CONTROLLED_SAAS;
  return base;
}

export function deriveTrustTransition(
  sourceServerId?: string,
  sinkServerId?: string,
  sourceToolName?: string,
  sinkToolName?: string,
): TrustTransition {
  const sourceTrust = getServerTrust(sourceServerId, sourceToolName);
  const sinkTrust = getServerTrust(sinkServerId, sinkToolName);

  if (!sourceTrust || !sinkTrust) {
    return { sourceTrust, sinkTrust, transition: undefined };
  }

  return {
    sourceTrust,
    sinkTrust,
    transition: `${sourceTrust} → ${sinkTrust}`,
  };
}

export function deriveCrossesTrustBoundary(
  sourceServerId?: string,
  sinkServerId?: string,
  sourceToolName?: string,
  sinkToolName?: string,
): boolean {
  const { sourceTrust, sinkTrust } = deriveTrustTransition(
    sourceServerId,
    sinkServerId,
    sourceToolName,
    sinkToolName,
  );
  if (!sourceTrust || !sinkTrust) return false;
  if (sourceTrust === sinkTrust) return false;
  const attackerControlledSource =
    sourceTrust === TrustZone.USER_CONTROLLED_SAAS || sourceTrust === TrustZone.EXTERNAL;
  const attackerReachableSink =
    sinkTrust === TrustZone.USER_CONTROLLED_SAAS || sinkTrust === TrustZone.EXTERNAL;
  return (
    attackerControlledSource ||
    attackerReachableSink ||
    isSensitiveTrustTransition(sourceTrust, sinkTrust)
  );
}

export function isSensitiveTrustTransition(
  sourceTrust?: TrustZone,
  sinkTrust?: TrustZone,
): boolean {
  if (!sourceTrust || !sinkTrust) return false;
  const externalish = new Set<TrustZone>([TrustZone.USER_CONTROLLED_SAAS, TrustZone.EXTERNAL]);
  const internalish = new Set<TrustZone>([TrustZone.LOCAL, TrustZone.INTERNAL]);
  return (
    (externalish.has(sourceTrust) && internalish.has(sinkTrust)) ||
    (internalish.has(sourceTrust) && externalish.has(sinkTrust))
  );
}

export function trustZoneToBoundary(zone?: TrustZone): TrustBoundary | undefined {
  if (!zone) return undefined;
  if (zone === TrustZone.USER_CONTROLLED_SAAS) return TrustBoundary.USER_CONTROLLED_SAAS;
  if (zone === TrustZone.CONTROLLED_SAAS) return TrustBoundary.CONTROLLED_SAAS;
  if (zone === TrustZone.LOCAL) return TrustBoundary.LOCAL;
  if (zone === TrustZone.INTERNAL) return TrustBoundary.INTERNAL;
  if (zone === TrustZone.EXTERNAL) return TrustBoundary.EXTERNAL;
  return TrustBoundary.UNKNOWN;
}
