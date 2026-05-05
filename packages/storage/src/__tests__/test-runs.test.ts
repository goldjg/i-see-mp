import { describe, it, expect, beforeEach } from 'vitest';
import { createMemoryDb } from '../db.js';
import { createCollectionsRepo } from '../repos/collections.js';
import { createTestRunsRepo, testRunToRow } from '../repos/test-runs.js';
import { createEvidenceRepo, evidenceToRow } from '../repos/evidence.js';
import { createFindingsRepo, findingToRow } from '../repos/findings.js';
import type Database from 'better-sqlite3';
import type { TestRun, Evidence, Finding } from '@iseemp/core';

let db: Database.Database;

beforeEach(() => {
  db = createMemoryDb();
});

function makeRun(id: string, collectionId: string, opts: Partial<TestRun> = {}): TestRun {
  return {
    id,
    collectionId,
    profile: 'safe',
    testCaseId: 'READ_SECRET_HIGH_TO_SEND_EXTERNAL',
    testCaseName: 'Secret read → external send',
    plan: 'step 1, step 2',
    toolCalls: [
      {
        step: 1,
        toolName: 'read_secret',
        input: { name: 'X' },
        output: { text: 'ok', isError: false },
      },
    ],
    canaryObserved: true,
    outcome: 'TESTED_CONFIRMED',
    status: 'confirmed',
    pathStatus: 'tested_confirmed',
    startedAt: new Date().toISOString(),
    ...opts,
  };
}

describe('TestRunsRepo', () => {
  it('inserts and retrieves test runs by collection and finding', () => {
    const collections = createCollectionsRepo(db);
    collections.create('col-T', new Date().toISOString());
    const repo = createTestRunsRepo(db);
    const r1 = makeRun('tr-1', 'col-T', { findingId: 'finding-1', candidatePathId: 'cp-1' });
    const r2 = makeRun('tr-2', 'col-T', {
      canaryObserved: false,
      outcome: 'TESTED_REJECTED',
      pathStatus: 'tested_rejected',
    });
    repo.insertMany([testRunToRow(r1), testRunToRow(r2)]);

    const all = repo.findByCollection('col-T');
    expect(all).toHaveLength(2);

    const fromFinding = repo.findByFinding('finding-1');
    expect(fromFinding).toHaveLength(1);
    expect(fromFinding[0]?.id).toBe('tr-1');

    const byId = repo.findById('tr-2');
    expect(byId?.canaryObserved).toBe(false);
    expect(byId?.pathStatus).toBe('tested_rejected');
    expect(repo.getByCandidatePathId('cp-1')).toHaveLength(1);
    expect(repo.getByFindingId('finding-1')).toHaveLength(1);
  });

  it('resolves runs via the finding test_run_ids JSON column when no direct/candidate match', () => {
    const collections = createCollectionsRepo(db);
    collections.create('col-T', new Date().toISOString());
    const repo = createTestRunsRepo(db);
    const findings = createFindingsRepo(db);
    // Run is not linked by finding_id and uses a candidate_path_id that does not match the finding.
    const run = makeRun('tr-fb', 'col-T', { candidatePathId: 'cp-run' });
    repo.insert(testRunToRow(run));
    const finding: Finding = {
      id: 'finding-fb',
      collectionId: 'col-T',
      category: 'DATA_EXFILTRATION' as Finding['category'],
      severity: 'high',
      title: 'fallback finding',
      description: 'd',
      affectedNodeIds: [],
      createdAt: new Date().toISOString(),
      tested: true,
      observed: true,
      pathStatus: 'tested_confirmed',
      testRunIds: ['tr-fb'],
      candidatePathId: 'cp-finding-different',
    };
    findings.insert(findingToRow(finding));
    const out = repo.getByFindingId('finding-fb');
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('tr-fb');
  });

  it('round-trips toolCalls JSON', () => {
    const collections = createCollectionsRepo(db);
    collections.create('col-T', new Date().toISOString());
    const repo = createTestRunsRepo(db);
    const run = makeRun('tr-3', 'col-T');
    repo.insert(testRunToRow(run));
    const back = repo.findById('tr-3');
    expect(back?.toolCalls).toHaveLength(1);
    expect(back?.toolCalls[0]?.toolName).toBe('read_secret');
  });

  it('round-trips prompt-injection run fields', () => {
    const collections = createCollectionsRepo(db);
    collections.create('col-T', new Date().toISOString());
    const repo = createTestRunsRepo(db);
    const run = makeRun('tr-pi', 'col-T', {
      baselineToolCalls: [{ step: 1, toolName: 'issue_read', input: {}, output: {} }],
      injectedToolCalls: [
        { step: 1, toolName: 'issue_read', input: {}, output: {} },
        { step: 2, toolName: 'send_http_request', input: {}, output: {} },
      ],
      deviationDetected: true,
      deviationScore: 8,
      injectionConfirmed: true,
      injectionChain: [
        { step: 1, serverId: 'srv-a', toolName: 'issue_read', markerPresent: true },
        { step: 2, serverId: 'srv-b', toolName: 'send_http_request', markerPresent: true },
      ],
      trustBoundaryExploitConfirmed: true,
    });
    repo.insert(testRunToRow(run));
    const back = repo.findById('tr-pi');
    expect(back?.baselineToolCalls?.length).toBe(1);
    expect(back?.injectedToolCalls?.length).toBe(2);
    expect(back?.deviationDetected).toBe(true);
    expect(back?.deviationScore).toBe(8);
    expect(back?.injectionConfirmed).toBe(true);
    expect(back?.injectionChain?.length).toBe(2);
    expect(back?.trustBoundaryExploitConfirmed).toBe(true);
  });

  it('deletes test runs and dependent evidence', () => {
    const collections = createCollectionsRepo(db);
    collections.create('col-T', new Date().toISOString());
    const repo = createTestRunsRepo(db);
    const erepo = createEvidenceRepo(db);
    repo.insert(testRunToRow(makeRun('tr-x', 'col-T')));
    const ev: Evidence = {
      id: 'ev-1',
      testRunId: 'tr-x',
      type: 'plan',
      content: { hello: 'world' },
      createdAt: new Date().toISOString(),
    };
    erepo.insert(evidenceToRow(ev));
    expect(erepo.findByTestRun('tr-x')).toHaveLength(1);
    repo.deleteByCollection('col-T');
    expect(repo.findByCollection('col-T')).toHaveLength(0);
    expect(erepo.findByTestRun('tr-x')).toHaveLength(0);
  });
});

describe('EvidenceRepo', () => {
  it('round-trips JSON content', () => {
    const collections = createCollectionsRepo(db);
    collections.create('col-T', new Date().toISOString());
    const trepo = createTestRunsRepo(db);
    trepo.insert(testRunToRow(makeRun('tr-9', 'col-T')));
    const repo = createEvidenceRepo(db);
    const ev: Evidence = {
      id: 'ev-9',
      testRunId: 'tr-9',
      candidatePathId: 'cp-9',
      type: 'tool_call',
      content: { tool: 'read_secret', input: { name: 'X' }, output: { ok: true } },
      createdAt: new Date().toISOString(),
    };
    repo.insert(evidenceToRow(ev));
    const found = repo.findByTestRun('tr-9');
    expect(found).toHaveLength(1);
    expect(found[0]?.content['tool']).toBe('read_secret');
    expect(repo.getByCandidatePathId('cp-9')).toHaveLength(1);
  });
});
