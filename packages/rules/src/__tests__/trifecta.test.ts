import { describe, it, expect } from 'vitest';
import { Capability, RiskCategory, TrustBoundary } from '@iseemp/core';
import type { Finding } from '@iseemp/core';
import { classifyFindingTrifecta, applyTrifectaAnalysis } from '../trifecta.js';
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

  it('classifies PARTIAL for sink-only finding', () => {
    const f = makeFinding({
      sourceCapabilities: [],
      sinkCapabilities: [Capability.SEND_EXTERNAL],
    });
    const out = classifyFindingTrifecta(f);
    expect(out.trifectaStage).toBe('PARTIAL');
    expect(out.trifectaComplete).toBe(false);
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

describe('applyTrifectaAnalysis ordering', () => {
  it('sorts COMPLETE before PARTIAL before CAPABILITY_ONLY', () => {
    const findings = [
      makeFinding({ id: 'c', sourceCapabilities: [], sinkCapabilities: [] }),
      makeFinding({ id: 'b', sourceCapabilities: [Capability.READ_SECRET_HIGH], sinkCapabilities: [] }),
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
