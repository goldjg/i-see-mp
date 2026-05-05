import { describe, it, expect } from 'vitest';
import { Capability, LethalTrifectaStatus, RiskCategory, TrustBoundary } from '@iseemp/core';
import type { Finding } from '@iseemp/core';
import {
  classifyFindingTrifecta,
  applyTrifectaAnalysis,
  deriveIsCrossServer,
} from '../trifecta.js';
import { deduplicateFindings } from '../findings-rules.js';

const now = new Date().toISOString();

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f-default',
    collectionId: 'c1',
    category: RiskCategory.UNVERIFIED_SERVER,
    severity: 'low',
    title: 'default',
    description: 'default',
    affectedNodeIds: ['server:s1'],
    createdAt: now,
    ...overrides,
  };
}

describe('classifyFindingTrifecta', () => {
  it('classifies COMPLETE for source + sink', () => {
    const f = makeFinding({
      sourceCapabilities: [Capability.READ_SECRET_HIGH],
      sinkCapabilities: [Capability.SEND_EXTERNAL],
    });
    const out = classifyFindingTrifecta(f);
    expect(out.trifectaStage).toBe('COMPLETE');
    expect(out.trifectaComplete).toBe(true);
    expect(out.trifectaScore).toBeGreaterThanOrEqual(9);
    expect(out.lethalTrifectaStatus).toBe(LethalTrifectaStatus.NONE);
  });

  it('does not treat isCrossServer flag alone as cross-server without server ids', () => {
    const f = makeFinding({
      sourceCapabilities: [Capability.READ_SECRET_HIGH],
      sinkCapabilities: [Capability.SEND_EXTERNAL],
      isCrossServer: true,
    });
    const out = classifyFindingTrifecta(f);
    expect(out.trifectaStage).toBe('COMPLETE');
    expect(out.trifectaComplete).toBe(true);
    expect(out.isCrossServer).toBe(false);
  });

  it('caps cross-server source + sink findings at PARTIAL from differing server ids', () => {
    const f = makeFinding({
      sourceCapabilities: [Capability.READ_LOCAL_FILE],
      sinkCapabilities: [Capability.SEND_EXTERNAL],
      sourceServerId: 'srv-a',
      sinkServerId: 'srv-b',
    });
    const out = classifyFindingTrifecta(f);
    expect(out.trifectaStage).toBe('PARTIAL');
    expect(out.trifectaComplete).toBe(false);
    expect(out.isCrossServer).toBe(true);
    expect(out.crossesTrustBoundary).toBe(false);
    expect(out.trustTransition).toBeUndefined();
  });

  it('classifies PARTIAL for source-only finding', () => {
    const f = makeFinding({
      sourceCapabilities: [Capability.READ_SECRET_HIGH],
      sinkCapabilities: [],
    });
    const out = classifyFindingTrifecta(f);
    expect(out.trifectaStage).toBe('PARTIAL');
    expect(out.trifectaComplete).toBe(false);
  });

  it('classifies filesystem local source-only finding as PARTIAL, not COMPLETE', () => {
    const f = makeFinding({
      sourceCapabilities: [Capability.READ_LOCAL_FILE],
      sinkCapabilities: [],
    });
    const out = classifyFindingTrifecta(f);
    expect(out.trifectaStage).toBe('PARTIAL');
    expect(out.trifectaComplete).toBe(false);
    expect(out.hasExternalCommunication).toBe(false);
    expect(out.lethalTrifectaStatus).toBe(LethalTrifectaStatus.NONE);
  });

  it('classifies PARTIAL for sink-only finding', () => {
    const f = makeFinding({
      sourceCapabilities: [],
      sinkCapabilities: [Capability.SEND_EXTERNAL],
    });
    const out = classifyFindingTrifecta(f);
    expect(out.trifectaStage).toBe('PARTIAL');
    expect(out.trifectaComplete).toBe(false);
    expect(out.hasPrivateDataAccess).toBe(false);
    expect(out.hasExternalCommunication).toBe(true);
    expect(out.hasUntrustedContentExposure).toBe(false);
    expect(out.lethalTrifectaStatus).toBe(LethalTrifectaStatus.NONE);
  });

  it('classifies lethal trifecta as CANDIDATE when private data + untrusted content + external sink are present', () => {
    const f = makeFinding({
      sourceCapabilities: [Capability.READ_SECRET_HIGH, Capability.UNTRUSTED_CONTENT_EXPOSURE],
      sinkCapabilities: [Capability.SEND_EXTERNAL],
    });
    const out = classifyFindingTrifecta(f);
    expect(out.trifectaStage).toBe('COMPLETE');
    expect(out.hasPrivateDataAccess).toBe(true);
    expect(out.hasUntrustedContentExposure).toBe(true);
    expect(out.hasExternalCommunication).toBe(true);
    expect(out.lethalTrifectaStatus).toBe(LethalTrifectaStatus.POSSIBLE);
  });

  it('keeps lethal trifecta NONE for untrusted-content-only finding', () => {
    const f = makeFinding({
      sourceCapabilities: [Capability.UNTRUSTED_CONTENT_EXPOSURE],
      sinkCapabilities: [],
    });
    const out = classifyFindingTrifecta(f);
    expect(out.hasPrivateDataAccess).toBe(false);
    expect(out.hasUntrustedContentExposure).toBe(true);
    expect(out.hasExternalCommunication).toBe(false);
    expect(out.lethalTrifectaStatus).toBe(LethalTrifectaStatus.NONE);
  });

  it('classifies CAPABILITY_ONLY when no source/sink capabilities exist', () => {
    const out = classifyFindingTrifecta(makeFinding());
    expect(out.trifectaStage).toBe('CAPABILITY_ONLY');
    expect(out.trifectaScore).toBe(1);
  });

  it('applies high-sensitivity and external-boundary bonuses', () => {
    const f = makeFinding({
      sourceCapabilities: [Capability.READ_SECRET_HIGH],
      sinkCapabilities: [Capability.SEND_EXTERNAL],
      boundaryCrossed: TrustBoundary.SAAS,
    });
    const out = classifyFindingTrifecta(f);
    expect(out.trifectaScore).toBe(11);
  });

  it('does not apply high-sensitivity bonus for low metadata source', () => {
    const f = makeFinding({
      sourceCapabilities: [Capability.READ_METADATA_LOW],
      sinkCapabilities: [Capability.SEND_EXTERNAL],
      boundaryCrossed: TrustBoundary.LOCAL,
    });
    const out = classifyFindingTrifecta(f);
    expect(out.trifectaScore).toBe(7);
  });

  it('infers execution sink for CODE_EXECUTION findings', () => {
    const f = makeFinding({
      category: RiskCategory.CODE_EXECUTION,
      sourceCapabilities: [Capability.RUN_SHELL],
      sinkCapabilities: [],
    });
    const out = classifyFindingTrifecta(f);
    expect(out.trifectaStage).toBe('PARTIAL');
    expect(out.trifectaScore).toBe(9);
  });

  it('infers mutation sink for PRIVILEGED_MUTATION findings', () => {
    const f = makeFinding({
      category: RiskCategory.PRIVILEGED_MUTATION,
      sourceCapabilities: [Capability.MUTATE_REMOTE_STATE],
      sinkCapabilities: [],
    });
    const out = classifyFindingTrifecta(f);
    expect(out.trifectaStage).toBe('PARTIAL');
    expect(out.trifectaComplete).toBe(false);
  });
});

describe('deriveIsCrossServer', () => {
  it('returns true when source/sink IDs are present and differ', () => {
    expect(deriveIsCrossServer({ sourceServerId: 'srv-a', sinkServerId: 'srv-b' })).toBe(true);
  });

  it('returns false when source/sink IDs are identical', () => {
    expect(deriveIsCrossServer({ sourceServerId: 'srv-a', sinkServerId: 'srv-a' })).toBe(false);
  });

  it('returns false when source ID is missing', () => {
    expect(deriveIsCrossServer({ sinkServerId: 'srv-b' })).toBe(false);
  });

  it('returns false when sink ID is missing', () => {
    expect(deriveIsCrossServer({ sourceServerId: 'srv-a' })).toBe(false);
  });

  it('returns false when both IDs are missing', () => {
    expect(deriveIsCrossServer({})).toBe(false);
  });
});

describe('applyTrifectaAnalysis ordering', () => {
  it('sorts COMPLETE before PARTIAL before CAPABILITY_ONLY', () => {
    const findings = [
      makeFinding({ id: 'c', sourceCapabilities: [], sinkCapabilities: [] }),
      makeFinding({
        id: 'b',
        sourceCapabilities: [Capability.READ_SECRET_HIGH],
        sinkCapabilities: [],
      }),
      makeFinding({
        id: 'a',
        sourceCapabilities: [Capability.READ_SECRET_HIGH],
        sinkCapabilities: [Capability.SEND_EXTERNAL],
      }),
    ];
    const sorted = applyTrifectaAnalysis(findings);
    expect(sorted.map((f) => f.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by higher trifectaScore within same stage', () => {
    const findings = [
      makeFinding({
        id: 'lower',
        sourceCapabilities: [Capability.READ_SECRET_HIGH],
        sinkCapabilities: [Capability.SEND_EXTERNAL],
      }),
      makeFinding({
        id: 'higher',
        sourceCapabilities: [Capability.READ_SECRET_HIGH],
        sinkCapabilities: [Capability.SEND_EXTERNAL],
        boundaryCrossed: TrustBoundary.SAAS,
      }),
    ];
    const sorted = applyTrifectaAnalysis(findings);
    expect(sorted.map((f) => f.id)).toEqual(['higher', 'lower']);
  });

  it('sorts by severity when stage/score tie', () => {
    const findings = [
      makeFinding({
        id: 'high',
        severity: 'high',
        sourceCapabilities: [Capability.READ_SECRET_HIGH],
        sinkCapabilities: [Capability.SEND_EXTERNAL],
      }),
      makeFinding({
        id: 'critical',
        severity: 'critical',
        sourceCapabilities: [Capability.READ_SECRET_HIGH],
        sinkCapabilities: [Capability.SEND_EXTERNAL],
      }),
    ];
    const sorted = applyTrifectaAnalysis(findings);
    expect(sorted.map((f) => f.id)).toEqual(['critical', 'high']);
  });

  it('sorts tested findings before untested when other keys tie', () => {
    const findings = [
      makeFinding({
        id: 'untested',
        tested: false,
        sourceCapabilities: [Capability.READ_SECRET_HIGH],
        sinkCapabilities: [Capability.SEND_EXTERNAL],
      }),
      makeFinding({
        id: 'tested',
        tested: true,
        sourceCapabilities: [Capability.READ_SECRET_HIGH],
        sinkCapabilities: [Capability.SEND_EXTERNAL],
      }),
    ];
    const sorted = applyTrifectaAnalysis(findings);
    expect(sorted.map((f) => f.id)).toEqual(['tested', 'untested']);
  });

  it('preserves finding count', () => {
    const findings = [
      makeFinding({ id: 'f1' }),
      makeFinding({ id: 'f2', sourceCapabilities: [Capability.READ_SECRET_HIGH] }),
      makeFinding({ id: 'f3', sinkCapabilities: [Capability.SEND_EXTERNAL] }),
    ];
    const sorted = applyTrifectaAnalysis(findings);
    expect(sorted).toHaveLength(findings.length);
  });

  it('adds trust fields when server ids map to trust levels', () => {
    const findings = [
      makeFinding({
        id: 'f-trust',
        sourceCapabilities: [Capability.READ_SECRET_HIGH],
        sinkCapabilities: [Capability.SEND_EXTERNAL],
        sourceServerId: 'filesystem',
        sinkServerId: 'fetch',
      }),
    ];
    const sorted = applyTrifectaAnalysis(findings);
    expect(sorted[0]?.trifectaStage).toBe('PARTIAL');
    expect(sorted[0]?.crossesTrustBoundary).toBe(true);
    expect(sorted[0]?.trustTransition).toBe('LOCAL → EXTERNAL');
    expect(sorted[0]?.isHighSignal).toBe(false);
  });

  it('sets isHighSignal when COMPLETE finding is trust-boundary crossing', () => {
    const findings = [
      makeFinding({
        id: 'f-high-signal',
        sourceCapabilities: [Capability.READ_SECRET_HIGH],
        sinkCapabilities: [Capability.SEND_EXTERNAL],
        sourceServerId: 'filesystem',
        sinkServerId: 'filesystem',
        crossesTrustBoundary: true,
      }),
    ];
    const sorted = applyTrifectaAnalysis(findings);
    expect(sorted[0]?.trifectaStage).toBe('COMPLETE');
    expect(sorted[0]?.isHighSignal).toBe(true);
  });

  it('sets isHighSignal when injection is confirmed', () => {
    const findings = [
      makeFinding({
        id: 'f-injection',
        category: RiskCategory.PROMPT_INJECTION,
        sourceCapabilities: [Capability.UNTRUSTED_CONTENT_EXPOSURE],
        sinkCapabilities: [Capability.SEND_EXTERNAL],
        injectionConfirmed: true,
      }),
    ];
    const sorted = applyTrifectaAnalysis(findings);
    expect(sorted[0]?.isHighSignal).toBe(true);
    expect(sorted[0]?.lethalTrifectaStatus).toBe('CONFIRMED');
  });

  it('marks trustBoundaryExploitConfirmed when injected sink crosses trust boundary', () => {
    const findings = [
      makeFinding({
        id: 'f-trust-exploit',
        category: RiskCategory.PROMPT_INJECTION,
        sourceCapabilities: [Capability.UNTRUSTED_CONTENT_EXPOSURE],
        sinkCapabilities: [Capability.SEND_EXTERNAL],
        injectionConfirmed: true,
        crossesTrustBoundary: true,
      }),
    ];
    const sorted = applyTrifectaAnalysis(findings);
    expect(sorted[0]?.trustBoundaryExploitConfirmed).toBe(true);
    expect(sorted[0]?.isHighSignal).toBe(true);
  });
});

describe('suppression interaction', () => {
  it('does not suppress trifecta-complete protected findings', () => {
    const protectedComplete = makeFinding({
      id: 'f-complete',
      category: RiskCategory.OVERBROAD_TOOL,
      severity: 'low',
      affectedNodeIds: ['server:s1', 'tool:t1'],
      sourceCapabilities: [Capability.READ_SECRET_HIGH],
      sinkCapabilities: [Capability.SEND_EXTERNAL],
      trifectaComplete: true,
    });
    const suppressor = makeFinding({
      id: 'f-suppressor',
      category: RiskCategory.CODE_EXECUTION,
      severity: 'critical',
      affectedNodeIds: ['server:s1', 'tool:t1'],
    });
    const deduped = deduplicateFindings([protectedComplete, suppressor]);
    expect(deduped.some((f) => f.id === 'f-complete')).toBe(true);
  });

  it('still suppresses OVERBROAD_TOOL when higher-severity CODE_EXECUTION exists', () => {
    const overbroad = makeFinding({
      id: 'f-overbroad',
      category: RiskCategory.OVERBROAD_TOOL,
      severity: 'medium',
      affectedNodeIds: ['server:s1', 'tool:t1'],
    });
    const exec = makeFinding({
      id: 'f-exec',
      category: RiskCategory.CODE_EXECUTION,
      severity: 'high',
      affectedNodeIds: ['server:s1', 'tool:t1'],
    });
    const deduped = deduplicateFindings([overbroad, exec]);
    expect(deduped.some((f) => f.id === 'f-overbroad')).toBe(false);
    expect(deduped.some((f) => f.id === 'f-exec')).toBe(true);
  });
});
