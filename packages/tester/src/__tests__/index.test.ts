import { describe, expect, it } from 'vitest';
import { PathStatus, TestOutcome, TestStatus, type TestRun } from '@iseemp/core';
import { summarizeRunsForCli } from '../index.js';

function makeRun(overrides: Partial<TestRun>): TestRun {
  return {
    id: 'tr-1',
    collectionId: 'col-1',
    profile: 'github-safe-canary',
    testCaseId: 'case-1',
    testCaseName: 'case',
    plan: 'plan',
    toolCalls: [],
    canaryObserved: false,
    outcome: TestOutcome.TESTED_INCONCLUSIVE,
    status: TestStatus.INCONCLUSIVE,
    pathStatus: PathStatus.TESTED_INCONCLUSIVE,
    startedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('summarizeRunsForCli', () => {
  it('counts by displayed pathStatus so CLI totals align with listed run statuses', () => {
    const runs: TestRun[] = [
      makeRun({
        id: 'confirmed',
        outcome: TestOutcome.TESTED_CONFIRMED,
        status: TestStatus.CONFIRMED,
        pathStatus: PathStatus.TESTED_CONFIRMED,
      }),
      makeRun({
        id: 'rejected',
        outcome: TestOutcome.TESTED_REJECTED,
        status: TestStatus.REJECTED,
        pathStatus: PathStatus.TESTED_REJECTED,
      }),
      makeRun({
        id: 'inconclusive-mismatch',
        outcome: TestOutcome.TEST_SKIPPED,
        status: TestStatus.INCONCLUSIVE,
        pathStatus: PathStatus.TESTED_INCONCLUSIVE,
      }),
      makeRun({
        id: 'trust-boundary',
        outcome: TestOutcome.TESTED_CONFIRMED,
        status: TestStatus.CONFIRMED,
        pathStatus: PathStatus.TRUST_BOUNDARY_CONFIRMED,
        deviationDetected: true,
        injectionConfirmed: true,
      }),
    ];

    const summary = summarizeRunsForCli(runs);
    expect(summary.confirmed).toBe(2);
    expect(summary.rejected).toBe(1);
    expect(summary.inconclusive).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.injectionConfirmed).toBe(1);
    expect(summary.trustBoundaryConfirmed).toBe(1);
    expect(summary.behaviouralDeviation).toBe(1);
  });
});
