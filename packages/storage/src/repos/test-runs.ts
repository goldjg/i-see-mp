import type Database from 'better-sqlite3';
import type { TestRun, ToolCall, PathStatus, TestStatus, TestProfile } from '@iseemp/core';

export interface TestRunRow {
  id: string;
  collection_id: string;
  profile: string;
  test_case_id: string;
  test_case_name: string;
  finding_id: string | null;
  path_summary: string | null;
  plan: string;
  tool_calls: string; // JSON
  canary_expected: string | null;
  canary_observed: number;
  status: string;
  path_status: string;
  started_at: string;
  completed_at: string | null;
  notes: string | null;
}

const COLUMNS =
  'id, collection_id, profile, test_case_id, test_case_name, finding_id, path_summary, plan, tool_calls, canary_expected, canary_observed, status, path_status, started_at, completed_at, notes';
const PLACEHOLDERS = '?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?';

function rowToTestRun(r: TestRunRow): TestRun {
  const run: TestRun = {
    id: r.id,
    collectionId: r.collection_id,
    profile: r.profile as TestProfile,
    testCaseId: r.test_case_id,
    testCaseName: r.test_case_name,
    plan: r.plan,
    toolCalls: JSON.parse(r.tool_calls) as ToolCall[],
    canaryObserved: r.canary_observed === 1,
    status: r.status as TestStatus,
    pathStatus: r.path_status as PathStatus,
    startedAt: r.started_at,
  };
  if (r.finding_id) run.findingId = r.finding_id;
  if (r.path_summary) run.pathSummary = r.path_summary;
  if (r.canary_expected) run.canaryExpected = r.canary_expected;
  if (r.completed_at) run.completedAt = r.completed_at;
  if (r.notes) run.notes = r.notes;
  return run;
}

export function testRunToRow(t: TestRun): TestRunRow {
  return {
    id: t.id,
    collection_id: t.collectionId,
    profile: t.profile,
    test_case_id: t.testCaseId,
    test_case_name: t.testCaseName,
    finding_id: t.findingId ?? null,
    path_summary: t.pathSummary ?? null,
    plan: t.plan,
    tool_calls: JSON.stringify(t.toolCalls),
    canary_expected: t.canaryExpected ?? null,
    canary_observed: t.canaryObserved ? 1 : 0,
    status: t.status,
    path_status: t.pathStatus,
    started_at: t.startedAt,
    completed_at: t.completedAt ?? null,
    notes: t.notes ?? null,
  };
}

export function createTestRunsRepo(db: Database.Database) {
  const insertSql = `INSERT OR REPLACE INTO test_runs (${COLUMNS}) VALUES (${PLACEHOLDERS})`;
  const bind = (r: TestRunRow): unknown[] => [
    r.id,
    r.collection_id,
    r.profile,
    r.test_case_id,
    r.test_case_name,
    r.finding_id,
    r.path_summary,
    r.plan,
    r.tool_calls,
    r.canary_expected,
    r.canary_observed,
    r.status,
    r.path_status,
    r.started_at,
    r.completed_at,
    r.notes,
  ];
  return {
    insert(row: TestRunRow): void {
      db.prepare(insertSql).run(...bind(row));
    },
    insertMany(rows: TestRunRow[]): void {
      const stmt = db.prepare(insertSql);
      const tx = db.transaction((items: TestRunRow[]) => {
        for (const r of items) stmt.run(...bind(r));
      });
      tx(rows);
    },
    findById(id: string): TestRun | undefined {
      const row = db.prepare(`SELECT * FROM test_runs WHERE id=?`).get(id) as TestRunRow | undefined;
      return row ? rowToTestRun(row) : undefined;
    },
    findByCollection(collectionId: string): TestRun[] {
      const rows = db
        .prepare(`SELECT * FROM test_runs WHERE collection_id=? ORDER BY started_at DESC`)
        .all(collectionId) as TestRunRow[];
      return rows.map(rowToTestRun);
    },
    findByFinding(findingId: string): TestRun[] {
      const rows = db
        .prepare(`SELECT * FROM test_runs WHERE finding_id=? ORDER BY started_at DESC`)
        .all(findingId) as TestRunRow[];
      return rows.map(rowToTestRun);
    },
    deleteByCollection(collectionId: string): void {
      db.prepare(
        `DELETE FROM evidence WHERE test_run_id IN (SELECT id FROM test_runs WHERE collection_id=?)`,
      ).run(collectionId);
      db.prepare(`DELETE FROM test_runs WHERE collection_id=?`).run(collectionId);
    },
  };
}
