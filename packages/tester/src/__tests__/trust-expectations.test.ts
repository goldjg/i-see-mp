import { describe, expect, it } from 'vitest';
import { PathStatus, RiskCategory, type Finding } from '@iseemp/core';
import {
  TRUST_ZONE,
  getKnownPairTrust,
  derivesExpectedTrustBoundaryCrossing,
  assertTrustBoundaryForPair,
  assertCrossServerAndTrustBoundaryIndependent,
  assertFindingTrustConsistency,
} from '../trust-expectations.js';
import { FILESYSTEM_FETCH_PROFILE } from '../profile-descriptor.js';

const baseFinding: Finding = {
  id: 'f-trust',
  collectionId: 'c-1',
  category: RiskCategory.DATA_EXFILTRATION,
  severity: 'high',
  title: 'title',
  description: 'desc',
  affectedNodeIds: ['n-1'],
  createdAt: new Date().toISOString(),
  pathStatus: PathStatus.TESTED_CONFIRMED,
};

describe('trust expectations', () => {
  it('cross-server true with trust-boundary true passes for filesystem→fetch', () => {
    const finding: Finding = {
      ...baseFinding,
      isCrossServer: true,
      sourceServerId: 'fs-id',
      sinkServerId: 'fetch-id',
      crossesTrustBoundary: true,
      trustTransition: 'LOCAL → EXTERNAL',
    };
    expect(() => assertTrustBoundaryForPair(finding, 'filesystem', 'fetch')).not.toThrow();
  });

  it('cross-server true with trust-boundary false passes for filesystem→github controlled', () => {
    const finding: Finding = {
      ...baseFinding,
      isCrossServer: true,
      sourceServerId: 'fs-id',
      sinkServerId: 'gh-id',
      crossesTrustBoundary: false,
      trustTransition: 'LOCAL → CONTROLLED_SAAS',
    };
    expect(() => assertTrustBoundaryForPair(finding, 'filesystem', 'github')).not.toThrow();
  });

  it('cross-server false and trust-boundary false is allowed when fields are explicit', () => {
    const finding: Finding = {
      ...baseFinding,
      isCrossServer: false,
      sourceServerId: 'fs-id',
      sinkServerId: 'fs-id',
      crossesTrustBoundary: false,
      trustTransition: 'LOCAL → LOCAL',
    };
    expect(() => assertCrossServerAndTrustBoundaryIndependent(finding)).not.toThrow();
  });

  it('same-server finding with structural signal is trust-consistent', () => {
    const finding: Finding = {
      ...baseFinding,
      isCrossServer: false,
      sourceServerId: 'fs-id',
      sinkServerId: 'fs-id',
      crossesTrustBoundary: false,
      trustTransition: 'LOCAL → LOCAL',
      trifectaStage: 'CAPABILITY_ONLY',
    };
    expect(() => assertFindingTrustConsistency(finding)).not.toThrow();
  });

  it('github→fetch transition expects trust-boundary crossing', () => {
    expect(
      derivesExpectedTrustBoundaryCrossing(TRUST_ZONE.CONTROLLED_SAAS, TRUST_ZONE.EXTERNAL),
    ).toBe(true);
  });

  it('github→fetch allows user-controlled source transition variant', () => {
    expect(
      getKnownPairTrust('github→fetch').some(
        (entry) =>
          entry.sourceTrustClass === TRUST_ZONE.USER_CONTROLLED_SAAS &&
          entry.sinkTrustClass === TRUST_ZONE.EXTERNAL &&
          entry.expectedTrustBoundaryCrossed === true,
      ),
    ).toBe(true);
  });

  it('known server pair trust marks filesystem→fetch as boundary crossing', () => {
    expect(getKnownPairTrust('filesystem→fetch')[0]!.expectedTrustBoundaryCrossed).toBe(true);
  });

  it('LOCAL→CONTROLLED_SAAS is not a trust-boundary crossing', () => {
    expect(derivesExpectedTrustBoundaryCrossing(TRUST_ZONE.LOCAL, TRUST_ZONE.CONTROLLED_SAAS)).toBe(
      false,
    );
  });

  it('filesystem-fetch profile expected trust transitions match central model', () => {
    expect(FILESYSTEM_FETCH_PROFILE.expectedTrustTransitions).toEqual([
      {
        sourceTrustClass: 'LOCAL',
        sinkTrustClass: 'EXTERNAL',
        crossesBoundary: true,
      },
    ]);
  });
});
