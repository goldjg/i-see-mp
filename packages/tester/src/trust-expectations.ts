import type { Finding } from '@iseemp/core';

export const TRUST_ZONE = {
  LOCAL: 'LOCAL',
  INTERNAL: 'INTERNAL',
  CONTROLLED_SAAS: 'CONTROLLED_SAAS',
  USER_CONTROLLED_SAAS: 'USER_CONTROLLED_SAAS',
  EXTERNAL: 'EXTERNAL',
  UNKNOWN: 'UNKNOWN',
} as const;

export type TrustZone = (typeof TRUST_ZONE)[keyof typeof TRUST_ZONE];

export interface PairTrustExpectation {
  sourceTrustClass: TrustZone;
  sinkTrustClass: TrustZone;
  expectedTrustBoundaryCrossed: boolean;
}

export type PairTrustKey = `${string}→${string}`;

interface TrustExpectationFindingLike {
  id?: string;
  isCrossServer?: boolean;
  sourceServerId?: string;
  sinkServerId?: string;
  crossesTrustBoundary?: boolean;
  trustTransition?: string;
}

function fail(message: string): never {
  throw new Error(message);
}

/**
 * Sensitive transitions move data between "internalish" zones (LOCAL/INTERNAL)
 * and "externalish" zones (USER_CONTROLLED_SAAS/EXTERNAL), which represents
 * elevated risk even when neither side is UNKNOWN.
 */
function isSensitiveTrustTransition(sourceZone?: TrustZone, sinkZone?: TrustZone): boolean {
  if (!sourceZone || !sinkZone) return false;
  const externalish = new Set<TrustZone>([TRUST_ZONE.USER_CONTROLLED_SAAS, TRUST_ZONE.EXTERNAL]);
  const internalish = new Set<TrustZone>([TRUST_ZONE.LOCAL, TRUST_ZONE.INTERNAL]);
  return (
    (externalish.has(sourceZone) && internalish.has(sinkZone)) ||
    (internalish.has(sourceZone) && externalish.has(sinkZone))
  );
}

export function derivesExpectedTrustBoundaryCrossing(sourceZone?: TrustZone, sinkZone?: TrustZone): boolean {
  if (!sourceZone || !sinkZone) return false;
  if (sourceZone === sinkZone) return false;
  const attackerControlledSource =
    sourceZone === TRUST_ZONE.USER_CONTROLLED_SAAS || sourceZone === TRUST_ZONE.EXTERNAL;
  const attackerReachableSink =
    sinkZone === TRUST_ZONE.USER_CONTROLLED_SAAS || sinkZone === TRUST_ZONE.EXTERNAL;
  return attackerControlledSource || attackerReachableSink || isSensitiveTrustTransition(sourceZone, sinkZone);
}

function makeExpectation(sourceTrustClass: TrustZone, sinkTrustClass: TrustZone): PairTrustExpectation {
  return {
    sourceTrustClass,
    sinkTrustClass,
    expectedTrustBoundaryCrossed: derivesExpectedTrustBoundaryCrossing(sourceTrustClass, sinkTrustClass),
  };
}

/**
 * Canonical trust expectations for known topology pairs used by tester-side
 * assertions and profile contracts. A pair can have multiple entries when
 * tool-level trust classification changes the transition (for example
 * filesystem→github can resolve to CONTROLLED_SAAS or USER_CONTROLLED_SAAS).
 */
export const KNOWN_SERVER_PAIR_TRUST: Record<PairTrustKey, PairTrustExpectation[]> = {
  'filesystem→fetch': [makeExpectation(TRUST_ZONE.LOCAL, TRUST_ZONE.EXTERNAL)],
  'filesystem→github': [
    makeExpectation(TRUST_ZONE.LOCAL, TRUST_ZONE.CONTROLLED_SAAS),
    makeExpectation(TRUST_ZONE.LOCAL, TRUST_ZONE.USER_CONTROLLED_SAAS),
  ],
  'github→fetch': [
    makeExpectation(TRUST_ZONE.CONTROLLED_SAAS, TRUST_ZONE.EXTERNAL),
    makeExpectation(TRUST_ZONE.USER_CONTROLLED_SAAS, TRUST_ZONE.EXTERNAL),
  ],
};

export function getKnownPairTrust(key: PairTrustKey): PairTrustExpectation[] {
  const value = KNOWN_SERVER_PAIR_TRUST[key];
  if (!Array.isArray(value) || value.length === 0) {
    fail(`No known trust expectation for pair '${key}'.`);
  }
  return value;
}

function parseTrustTransition(transition?: string): { sourceTrustClass?: TrustZone; sinkTrustClass?: TrustZone } {
  if (!transition) return {};
  const parts = transition.split('→').map((part) => part.trim());
  if (parts.length !== 2) return {};
  const sourceTrustClass = parts[0] as TrustZone | undefined;
  const sinkTrustClass = parts[1] as TrustZone | undefined;
  if (!sourceTrustClass || !sinkTrustClass) return {};
  return { sourceTrustClass, sinkTrustClass };
}

function resolveExpectedBoundaryForPair(
  finding: TrustExpectationFindingLike,
  sourceName: string,
  sinkName: string,
): { expected: boolean; transition: string } {
  const key = `${sourceName}→${sinkName}` as PairTrustKey;
  const candidates = getKnownPairTrust(key);
  const parsed = parseTrustTransition(finding.trustTransition);
  if (parsed.sourceTrustClass && parsed.sinkTrustClass) {
    const match = candidates.find(
      (candidate) =>
        candidate.sourceTrustClass === parsed.sourceTrustClass && candidate.sinkTrustClass === parsed.sinkTrustClass,
    );
    if (match) {
      return {
        expected: match.expectedTrustBoundaryCrossed,
        transition: `${match.sourceTrustClass} → ${match.sinkTrustClass}`,
      };
    }
  }
  const unique = Array.from(new Set(candidates.map((candidate) => candidate.expectedTrustBoundaryCrossed)));
  if (unique.length === 1) {
    const transitions = candidates
      .map((candidate) => `${candidate.sourceTrustClass} → ${candidate.sinkTrustClass}`)
      .join(' | ');
    const expected = unique[0];
    if (typeof expected !== 'boolean') {
      fail(`Internal trust expectation error: could not resolve unique boundary value for pair '${key}'.`);
    }
    return {
      expected,
      transition: transitions,
    };
  }
  fail(
    `Pair '${key}' has multiple trust-transition outcomes; finding must include trustTransition to disambiguate.`,
  );
}

export function assertTrustBoundaryForPair(
  finding: TrustExpectationFindingLike,
  sourceName: string,
  sinkName: string,
): void {
  if (typeof finding.crossesTrustBoundary !== 'boolean') {
    fail(
      `Expected finding ${finding.id ?? '<unknown>'} to include boolean crossesTrustBoundary before pair trust assertion.`,
    );
  }
  const { expected, transition } = resolveExpectedBoundaryForPair(finding, sourceName, sinkName);
  if (finding.crossesTrustBoundary !== expected) {
    fail(
      `Expected ${sourceName} → ${sinkName} (${transition}) crossesTrustBoundary=${expected}, got ${finding.crossesTrustBoundary}.`,
    );
  }
}

export function assertCrossServerAndTrustBoundaryIndependent(finding: TrustExpectationFindingLike): void {
  if (typeof finding.isCrossServer !== 'boolean') {
    fail(`Expected finding ${finding.id ?? '<unknown>'} to include boolean isCrossServer.`);
  }
  if (typeof finding.crossesTrustBoundary !== 'boolean') {
    fail(`Expected finding ${finding.id ?? '<unknown>'} to include boolean crossesTrustBoundary.`);
  }
}

export interface TrustConsistencyOptions {
  sourceName?: string;
  sinkName?: string;
}

export function assertFindingTrustConsistency(
  finding: TrustExpectationFindingLike | Finding,
  opts: TrustConsistencyOptions = {},
): void {
  assertCrossServerAndTrustBoundaryIndependent(finding);
  if (finding.isCrossServer === true) {
    if (typeof finding.sourceServerId !== 'string' || finding.sourceServerId.length === 0) {
      fail(`Cross-server finding ${finding.id ?? '<unknown>'} is missing sourceServerId.`);
    }
    if (typeof finding.sinkServerId !== 'string' || finding.sinkServerId.length === 0) {
      fail(`Cross-server finding ${finding.id ?? '<unknown>'} is missing sinkServerId.`);
    }
    if (finding.sourceServerId === finding.sinkServerId) {
      fail(`Cross-server finding ${finding.id ?? '<unknown>'} has identical source and sink server IDs.`);
    }
  }
  const { sourceTrustClass, sinkTrustClass } = parseTrustTransition(finding.trustTransition);
  if (sourceTrustClass && sinkTrustClass) {
    const expected = derivesExpectedTrustBoundaryCrossing(sourceTrustClass, sinkTrustClass);
    if (finding.crossesTrustBoundary !== expected) {
      fail(
        `Expected trustTransition '${sourceTrustClass} → ${sinkTrustClass}' to produce crossesTrustBoundary=${expected}, got ${finding.crossesTrustBoundary}.`,
      );
    }
    if (sinkTrustClass === TRUST_ZONE.EXTERNAL && finding.crossesTrustBoundary !== true) {
      fail(`Expected sink trust class EXTERNAL to require crossesTrustBoundary=true.`);
    }
  }
  if (opts.sourceName && opts.sinkName) {
    assertTrustBoundaryForPair(finding, opts.sourceName, opts.sinkName);
  }
}
