import { describe, expect, it } from 'vitest';
import { PathStatus, RiskCategory, TestOutcome, TestStatus, type Finding, type TestRun } from '@iseemp/core';
import {
  assertCanaryEvidence,
  assertHasCapability,
  assertHasFindingWithStatus,
  assertHasServer,
  assertHasTrustTransition,
  assertNoCoercionEvidence,
  assertNoFindingWithStatus,
  assertNoUnexpectedLethalTrifectaConfirmed,
  assertNoUnexpectedPromptInjectionConfirmed,
  assertProfileSummary,
} from '../profile-assertions.js';
import {
  FILESYSTEM_ONLY_PROFILE,
  PROMPT_INJECTION_GITHUB_DESCRIPTOR,
} from '../profile-descriptor.js';

const baseFinding: Finding = {
  id: 'f-1',
  collectionId: 'c-1',
  category: RiskCategory.DATA_EXFILTRATION,
  severity: 'high',
  title: 't',
  description: 'd',
  affectedNodeIds: ['tool:x'],
  createdAt: new Date().toISOString(),
  pathStatus: PathStatus.TESTED_CONFIRMED,
};

const baseRun: TestRun = {
  id: 'tr-1',
  collectionId: 'c-1',
  profile: 'safe',
  testCaseId: 'case-1',
  testCaseName: 'case',
  plan: 'plan',
  toolCalls: [],
  canaryObserved: true,
  outcome: TestOutcome.TESTED_CONFIRMED,
  status: TestStatus.CONFIRMED,
  pathStatus: PathStatus.TESTED_CONFIRMED,
  startedAt: new Date().toISOString(),
};

describe('profile assertions', () => {
  it('assertProfileSummary pass and fail', () => {
    const summary = {
      profilesPlanned: 1,
      profilesRun: 1,
      profilesSkipped: 0,
      profilesPassed: 1,
      profilesFailed: 0,
    };
    expect(() => assertProfileSummary(summary, { profilesPlanned: 1, profilesRun: 1 })).not.toThrow();
    expect(() => assertProfileSummary(summary, { profilesFailed: 1 })).toThrow(/profilesFailed/);
  });

  it('assertHasServer pass and fail', () => {
    const servers = [{ id: 's-1', name: 'filesystem' }];
    expect(assertHasServer(servers, 'filesystem').id).toBe('s-1');
    expect(() => assertHasServer(servers, 'github')).toThrow(/Expected server/);
  });

  it('assertHasCapability pass and fail', () => {
    const tools = [{ serverId: 's-1', capabilities: ['READ_LOCAL_FILE'] }];
    expect(() => assertHasCapability(tools, 's-1', 'READ_LOCAL_FILE')).not.toThrow();
    expect(() => assertHasCapability(tools, 's-1', 'SEND_HTTP')).toThrow(/Expected capability/);
  });

  it('assertHasFindingWithStatus pass and fail', () => {
    expect(assertHasFindingWithStatus([baseFinding], PathStatus.TESTED_CONFIRMED).id).toBe('f-1');
    expect(() => assertHasFindingWithStatus([baseFinding], PathStatus.TESTED_REJECTED)).toThrow(
      /Expected at least one finding/,
    );
  });

  it('assertNoFindingWithStatus pass and fail', () => {
    expect(() => assertNoFindingWithStatus([baseFinding], PathStatus.TESTED_REJECTED)).not.toThrow();
    expect(() => assertNoFindingWithStatus([baseFinding], PathStatus.TESTED_CONFIRMED)).toThrow(
      /Expected no findings/,
    );
  });

  it('assertHasTrustTransition pass and fail', () => {
    const finding = { ...baseFinding, trustTransition: 'LOCAL → EXTERNAL' };
    expect(assertHasTrustTransition([finding], 'LOCAL', 'EXTERNAL').id).toBe('f-1');
    expect(() => assertHasTrustTransition([finding], 'LOCAL', 'SAAS')).toThrow(/Expected trust transition/);
  });

  it('assertCanaryEvidence pass and fail', () => {
    expect(() => assertCanaryEvidence([baseRun])).not.toThrow();
    expect(() => assertCanaryEvidence([{ ...baseRun, canaryObserved: false }])).toThrow(/canaryObserved/);
  });

  it('assertNoCoercionEvidence pass and fail', () => {
    expect(() => assertNoCoercionEvidence([baseRun])).not.toThrow();
    expect(() => assertNoCoercionEvidence([{ ...baseRun, deviationDetected: true }])).toThrow(
      /Expected no coercion evidence/,
    );
  });

  it('assertNoUnexpectedPromptInjectionConfirmed pass and fail', () => {
    const injectionFinding = { ...baseFinding, injectionConfirmed: true };
    expect(() =>
      assertNoUnexpectedPromptInjectionConfirmed([injectionFinding], PROMPT_INJECTION_GITHUB_DESCRIPTOR),
    ).not.toThrow();
    expect(() =>
      assertNoUnexpectedPromptInjectionConfirmed([injectionFinding], FILESYSTEM_ONLY_PROFILE),
    ).toThrow(/does not allow prompt-injection confirmation/);
  });

  it('assertNoUnexpectedLethalTrifectaConfirmed pass and fail', () => {
    const lethalFinding = { ...baseFinding, lethalTrifectaStatus: 'CONFIRMED' as const };
    expect(() =>
      assertNoUnexpectedLethalTrifectaConfirmed([lethalFinding], PROMPT_INJECTION_GITHUB_DESCRIPTOR),
    ).not.toThrow();
    expect(() =>
      assertNoUnexpectedLethalTrifectaConfirmed([lethalFinding], FILESYSTEM_ONLY_PROFILE),
    ).toThrow(/does not allow coercion-only lethal confirmation/);
  });
});
