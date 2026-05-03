export const TrustLevel = {
  LOCAL: 'LOCAL',
  EXTERNAL: 'EXTERNAL',
} as const;

export type TrustLevel = (typeof TrustLevel)[keyof typeof TrustLevel];

export const SERVER_TRUST_MAP: Record<string, TrustLevel> = {
  filesystem: TrustLevel.LOCAL,
  fetch: TrustLevel.EXTERNAL,
  github: TrustLevel.EXTERNAL,
};

export interface TrustTransition {
  sourceTrust?: TrustLevel;
  sinkTrust?: TrustLevel;
  transition?: string;
}

export function getServerTrust(serverId?: string): TrustLevel | undefined {
  if (!serverId) return undefined;
  return SERVER_TRUST_MAP[serverId];
}

export function deriveTrustTransition(
  sourceServerId?: string,
  sinkServerId?: string,
): TrustTransition {
  const sourceTrust = getServerTrust(sourceServerId);
  const sinkTrust = getServerTrust(sinkServerId);

  if (!sourceTrust || !sinkTrust) {
    return { sourceTrust, sinkTrust, transition: undefined };
  }

  return {
    sourceTrust,
    sinkTrust,
    transition: `${sourceTrust} → ${sinkTrust}`,
  };
}

export function deriveCrossesTrustBoundary(sourceServerId?: string, sinkServerId?: string): boolean {
  const { sourceTrust, sinkTrust } = deriveTrustTransition(sourceServerId, sinkServerId);
  if (!sourceTrust || !sinkTrust) return false;
  return sourceTrust !== sinkTrust;
}
