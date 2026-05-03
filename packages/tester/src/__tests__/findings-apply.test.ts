import { describe, expect, it } from 'vitest';
import { Confidence, PathStatus, RiskCategory, TestOutcome } from '@iseemp/core';
import { createMemoryDb, createFindingsRepo, findingToRow, createCollectionsRepo } from '@iseemp/storage';
import type { Finding, TestRun } from '@iseemp/core';
import { applyRunsToFinding, applyTestResultsToFindings, matchRunsToFinding } from '../index.js';
import { SAFE_PROFILE_DESCRIPTOR, PROMPT_INJECTION_GITHUB_DESCRIPTOR } from '../profile-descriptor.js';

function makeFinding(id: string, candidatePathId?: string): Finding {
  return {
    id,
    collectionId: 'col-1',
    category: RiskCategory.DATA_EXFILTRATION,
    severity: 'high',
    title: 'f',
    description: 'd',
    affectedNodeIds: ['server:srv-1', 'tool:source-1', 'tool:sink-1'],
    createdAt: new Date().toISOString(),
    confidence: Confidence.MEDIUM,
    staticPossible: true,
    tested: false,
    observed: false,
    pathStatus: PathStatus.STATIC_POSSIBLE,
    candidatePathId,
  };
}

function makeRun(outcome: TestOutcome, candidatePathId = 'cp-1'): TestRun {
  return {
    id: `run-${outcome}`,
    collectionId: 'col-1',
    profile: 'safe',
    testCaseId: 'READ_SECRET_HIGH_TO_SEND_EXTERNAL',
    testCaseName: 'case',
    candidatePathId,
    serverId: 'srv-1',
    sourceToolId: 'source-1',
    sinkToolId: 'sink-1',
    pathSummary: 'READ_SECRET_HIGH -> MODEL_CONTEXT -> SEND_EXTERNAL',
    plan: 'plan',
    toolCalls: [],
    canaryObserved: outcome === TestOutcome.TESTED_CONFIRMED,
    outcome,
    status: 'confirmed',
    pathStatus:
      outcome === TestOutcome.TESTED_CONFIRMED
        ? PathStatus.TESTED_CONFIRMED
        : outcome === TestOutcome.TESTED_REJECTED
          ? PathStatus.TESTED_REJECTED
          : PathStatus.TESTED_INCONCLUSIVE,
    startedAt: new Date().toISOString(),
  };
}

describe('finding updates from deterministic test outcomes', () => {
  it('links run to finding by candidatePathId', () => {
    const finding = makeFinding('f-1', 'cp-1');
    const updated = applyRunsToFinding(finding, [makeRun(TestOutcome.TESTED_CONFIRMED, 'cp-1')]);
    expect(updated.pathStatus).toBe(PathStatus.TESTED_CONFIRMED);
    expect(updated.testRunIds).toEqual(['run-TESTED_CONFIRMED']);
  });

  it('CONFIRMED bumps confidence and severity', () => {
    const finding = makeFinding('f-2', 'cp-2');
    const updated = applyRunsToFinding(finding, [makeRun(TestOutcome.TESTED_CONFIRMED, 'cp-2')]);
    expect(updated.severity).toBe('high');
    expect(updated.confidence).toBe(Confidence.HIGH);
  });

  it('REJECTED downgrades severity strongly', () => {
    const finding = { ...makeFinding('f-3', 'cp-3'), severity: 'critical' as const };
    const updated = applyRunsToFinding(finding, [makeRun(TestOutcome.TESTED_REJECTED, 'cp-3')]);
    expect(updated.pathStatus).toBe(PathStatus.TESTED_REJECTED);
    expect(updated.severity).toBe('medium');
    expect(updated.confidence).toBe(Confidence.LOW);
  });

  it('INCONCLUSIVE reduces confidence and keeps severity', () => {
    const finding = makeFinding('f-4', 'cp-4');
    const updated = applyRunsToFinding(finding, [makeRun(TestOutcome.TESTED_INCONCLUSIVE, 'cp-4')]);
    expect(updated.pathStatus).toBe(PathStatus.TESTED_INCONCLUSIVE);
    expect(updated.severity).toBe('high');
    expect(updated.confidence).toBe(Confidence.LOW);
  });

  it('repeated apply does not duplicate findings rows', () => {
    const db = createMemoryDb();
    createCollectionsRepo(db).create('col-1', new Date().toISOString());
    const findingsRepo = createFindingsRepo(db);
    findingsRepo.insert(findingToRow(makeFinding('f-5', 'cp-5')));
    const runs = [makeRun(TestOutcome.TESTED_CONFIRMED, 'cp-5')];
    applyTestResultsToFindings('col-1', runs, findingsRepo, SAFE_PROFILE_DESCRIPTOR);
    applyTestResultsToFindings('col-1', runs, findingsRepo, SAFE_PROFILE_DESCRIPTOR);
    const rows = findingsRepo.findByCollection('col-1').filter((f) => f.id === 'f-5');
    expect(rows).toHaveLength(1);
  });

  it('fuzzy-matches github-safe privileged mutation runs by category + affected nodes', () => {
    const finding = {
      ...makeFinding('f-gh-1'),
      category: RiskCategory.PRIVILEGED_MUTATION,
      affectedNodeIds: ['server:srv-1', 'tool:source-1'],
    };
    const run = {
      ...makeRun(TestOutcome.TESTED_CONFIRMED, 'cp-gh-1'),
      profile: 'github-safe-canary' as const,
      testCaseId: 'GITHUB_REPOSITORY_MUTATION_CONTROLLED_ARTIFACT',
    };
    const matched = matchRunsToFinding(finding, [run]);
    expect(matched).toHaveLength(1);
  });

  it('does not mark prompt injection confirmed for dataflow-only profile', () => {
    const finding = {
      ...makeFinding('f-pi-1', 'cp-pi-1'),
      category: RiskCategory.PROMPT_INJECTION,
      lethalTrifectaStatus: 'POSSIBLE' as const,
    };
    const run = {
      ...makeRun(TestOutcome.TESTED_CONFIRMED, 'cp-pi-1'),
      profile: 'safe' as const,
      testCaseId: 'PROMPT_INJECTION_GITHUB_ISSUE_TO_SINK',
    };
    const updated = applyRunsToFinding(finding, [run], SAFE_PROFILE_DESCRIPTOR);
    expect(updated.injectionConfirmed).toBe(false);
    expect(updated.lethalTrifectaStatus).toBe('POSSIBLE');
  });

  it('marks prompt injection confirmed for coercion profile', () => {
    const finding = {
      ...makeFinding('f-pi-2', 'cp-pi-2'),
      category: RiskCategory.PROMPT_INJECTION,
      lethalTrifectaStatus: 'POSSIBLE' as const,
    };
    const run = {
      ...makeRun(TestOutcome.TESTED_CONFIRMED, 'cp-pi-2'),
      profile: 'prompt-injection-github' as const,
      testCaseId: 'PROMPT_INJECTION_GITHUB_ISSUE_TO_SINK',
    };
    const updated = applyRunsToFinding(finding, [run], PROMPT_INJECTION_GITHUB_DESCRIPTOR);
    expect(updated.injectionConfirmed).toBe(true);
    expect(updated.lethalTrifectaStatus).toBe('CONFIRMED');
  });

});
