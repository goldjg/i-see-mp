import { describe, expect, it } from 'vitest';
import {
  TrustLevel,
  deriveCrossesTrustBoundary,
  deriveTrustTransition,
  getServerTrust,
} from '../trust.js';

describe('getServerTrust', () => {
  it('maps known servers', () => {
    expect(getServerTrust('filesystem')).toBe(TrustLevel.LOCAL);
    expect(getServerTrust('fetch')).toBe(TrustLevel.EXTERNAL);
    expect(getServerTrust('github')).toBe(TrustLevel.EXTERNAL);
  });

  it('returns undefined for unknown server', () => {
    expect(getServerTrust('unknown-server')).toBeUndefined();
  });
});

describe('deriveCrossesTrustBoundary', () => {
  it('returns true for LOCAL -> EXTERNAL', () => {
    expect(deriveCrossesTrustBoundary('filesystem', 'github')).toBe(true);
  });

  it('returns false for EXTERNAL -> EXTERNAL', () => {
    expect(deriveCrossesTrustBoundary('github', 'fetch')).toBe(false);
  });

  it('returns false when source trust is unknown', () => {
    expect(deriveCrossesTrustBoundary('unknown', 'fetch')).toBe(false);
  });

  it('returns false when both trusts are unknown', () => {
    expect(deriveCrossesTrustBoundary('unknown-a', 'unknown-b')).toBe(false);
  });
});

describe('deriveTrustTransition', () => {
  it('returns LOCAL -> EXTERNAL transition for filesystem -> github', () => {
    expect(deriveTrustTransition('filesystem', 'github')).toEqual({
      sourceTrust: 'LOCAL',
      sinkTrust: 'EXTERNAL',
      transition: 'LOCAL → EXTERNAL',
    });
  });

  it('returns EXTERNAL -> EXTERNAL transition for github -> fetch', () => {
    expect(deriveTrustTransition('github', 'fetch')).toEqual({
      sourceTrust: 'EXTERNAL',
      sinkTrust: 'EXTERNAL',
      transition: 'EXTERNAL → EXTERNAL',
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
