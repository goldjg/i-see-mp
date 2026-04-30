import { describe, it, expect, beforeEach } from 'vitest';
import { createMemoryDb } from '../db.js';
import { createCollectionsRepo } from '../repos/collections.js';
import { createTestRunsRepo, testRunToRow } from '../repos/test-runs.js';
import { createEvidenceRepo, evidenceToRow } from '../repos/evidence.js';
import type Database from 'better-sqlite3';
import type { TestRun, Evidence } from '@iseemp/core';

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
    const r1 = makeRun('tr-1', 'col-T', { findingId: 'finding-1' });
    const r2 = makeRun('tr-2', 'col-T', { canaryObserved: false, pathStatus: 'tested_rejected' });
    repo.insertMany([testRunToRow(r1), testRunToRow(r2)]);

    const all = repo.findByCollection('col-T');
    expect(all).toHaveLength(2);

    const fromFinding = repo.findByFinding('finding-1');
    expect(fromFinding).toHaveLength(1);
    expect(fromFinding[0]?.id).toBe('tr-1');

    const byId = repo.findById('tr-2');
    expect(byId?.canaryObserved).toBe(false);
    expect(byId?.pathStatus).toBe('tested_rejected');
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
      type: 'tool_call',
      content: { tool: 'read_secret', input: { name: 'X' }, output: { ok: true } },
      createdAt: new Date().toISOString(),
    };
    repo.insert(evidenceToRow(ev));
    const found = repo.findByTestRun('tr-9');
    expect(found).toHaveLength(1);
    expect(found[0]?.content['tool']).toBe('read_secret');
  });
});
