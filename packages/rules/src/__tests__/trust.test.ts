import { describe, expect, it } from 'vitest';
import {
  TrustZone,
  deriveCrossesTrustBoundary,
  deriveTrustTransition,
  getServerTrust,
  isSensitiveTrustTransition,
} from '../trust.js';

describe('getServerTrust', () => {
  it('maps known servers', () => {
    expect(getServerTrust('filesystem')).toBe(TrustZone.LOCAL);
    expect(getServerTrust('fetch')).toBe(TrustZone.EXTERNAL);
    expect(getServerTrust('github')).toBe(TrustZone.CONTROLLED_SAAS);
  });

  it('uses tool-aware github trust zoning', () => {
    expect(getServerTrust('github', 'issue_read')).toBe(TrustZone.USER_CONTROLLED_SAAS);
    expect(getServerTrust('github', 'get_file_contents')).toBe(TrustZone.CONTROLLED_SAAS);
  });

  it('returns undefined for unknown server', () => {
    expect(getServerTrust('unknown-server')).toBeUndefined();
  });
});

describe('deriveCrossesTrustBoundary', () => {
  it('returns true for LOCAL -> EXTERNAL', () => {
    expect(deriveCrossesTrustBoundary('filesystem', 'fetch')).toBe(true);
  });

  it('returns true for CONTROLLED_SAAS -> EXTERNAL', () => {
    expect(deriveCrossesTrustBoundary('github', 'fetch')).toBe(true);
  });

  it('returns false for LOCAL -> CONTROLLED_SAAS', () => {
    expect(deriveCrossesTrustBoundary('filesystem', 'github')).toBe(false);
  });

  it('returns false when source trust is unknown', () => {
    expect(deriveCrossesTrustBoundary('unknown', 'fetch')).toBe(false);
  });

  it('returns false when both trusts are unknown', () => {
    expect(deriveCrossesTrustBoundary('unknown-a', 'unknown-b')).toBe(false);
  });
});

describe('deriveTrustTransition', () => {
  it('returns LOCAL -> EXTERNAL transition for filesystem -> fetch', () => {
    expect(deriveTrustTransition('filesystem', 'fetch')).toEqual({
      sourceTrust: 'LOCAL',
      sinkTrust: 'EXTERNAL',
      transition: 'LOCAL → EXTERNAL',
    });
  });

  it('returns LOCAL -> CONTROLLED_SAAS transition for filesystem -> github', () => {
    expect(deriveTrustTransition('filesystem', 'github')).toEqual({
      sourceTrust: 'LOCAL',
      sinkTrust: 'CONTROLLED_SAAS',
      transition: 'LOCAL → CONTROLLED_SAAS',
    });
  });

  it('returns USER_CONTROLLED_SAAS -> EXTERNAL transition with tool hints', () => {
    expect(deriveTrustTransition('github', 'fetch', 'issue_read')).toEqual({
      sourceTrust: 'USER_CONTROLLED_SAAS',
      sinkTrust: 'EXTERNAL',
      transition: 'USER_CONTROLLED_SAAS → EXTERNAL',
    });
  });

  it('returns CONTROLLED_SAAS -> EXTERNAL transition for github -> fetch', () => {
    expect(deriveTrustTransition('github', 'fetch')).toEqual({
      sourceTrust: 'CONTROLLED_SAAS',
      sinkTrust: 'EXTERNAL',
      transition: 'CONTROLLED_SAAS → EXTERNAL',
    });
  });

  it('returns undefined transition when a trust level is missing', () => {
    expect(deriveTrustTransition('filesystem', 'unknown')).toEqual({
      sourceTrust: 'LOCAL',
      sinkTrust: undefined,
      transition: undefined,
    });
  });
});

describe('isSensitiveTrustTransition', () => {
  it('detects external/user-controlled to local/internal transitions', () => {
    expect(isSensitiveTrustTransition(TrustZone.USER_CONTROLLED_SAAS, TrustZone.LOCAL)).toBe(true);
    expect(isSensitiveTrustTransition(TrustZone.EXTERNAL, TrustZone.INTERNAL)).toBe(true);
  });

  it('detects local/internal to external/user-controlled transitions', () => {
    expect(isSensitiveTrustTransition(TrustZone.LOCAL, TrustZone.EXTERNAL)).toBe(true);
    expect(isSensitiveTrustTransition(TrustZone.INTERNAL, TrustZone.USER_CONTROLLED_SAAS)).toBe(
      true,
    );
  });

  it('does not flag same trust class transitions', () => {
    expect(isSensitiveTrustTransition(TrustZone.LOCAL, TrustZone.INTERNAL)).toBe(false);
    expect(
      isSensitiveTrustTransition(TrustZone.CONTROLLED_SAAS, TrustZone.USER_CONTROLLED_SAAS),
    ).toBe(false);
  });
});
