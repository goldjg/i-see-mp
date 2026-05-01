import type Database from 'better-sqlite3';
import type { Evidence } from '@iseemp/core';

export interface EvidenceRow {
  id: string;
  test_run_id: string;
  candidate_path_id: string | null;
  type: string;
  step_index: number | null;
  tool_name: string | null;
  redacted_input: string | null;
  redacted_output: string | null;
  content: string; // JSON
  created_at: string;
}

function rowToEvidence(r: EvidenceRow): Evidence {
  return {
    id: r.id,
    testRunId: r.test_run_id,
    candidatePathId: r.candidate_path_id ?? undefined,
    type: r.type,
    stepIndex: r.step_index ?? undefined,
    toolName: r.tool_name ?? undefined,
    redactedInput: r.redacted_input ? (JSON.parse(r.redacted_input) as Record<string, unknown>) : undefined,
    redactedOutput: r.redacted_output ? (JSON.parse(r.redacted_output) as unknown) : undefined,
    content: JSON.parse(r.content) as Record<string, unknown>,
    createdAt: r.created_at,
  };
}

export function evidenceToRow(e: Evidence): EvidenceRow {
  return {
    id: e.id,
    test_run_id: e.testRunId,
    candidate_path_id: e.candidatePathId ?? null,
    type: e.type,
    step_index: e.stepIndex ?? null,
    tool_name: e.toolName ?? null,
    redacted_input: e.redactedInput ? JSON.stringify(e.redactedInput) : null,
    redacted_output: e.redactedOutput === undefined ? null : JSON.stringify(e.redactedOutput),
    content: JSON.stringify(e.content),
    created_at: e.createdAt,
  };
}

export function createEvidenceRepo(db: Database.Database) {
  const insertSql =
    'INSERT OR REPLACE INTO evidence (id, test_run_id, candidate_path_id, type, step_index, tool_name, redacted_input, redacted_output, content, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)';
  return {
    insert(row: EvidenceRow): void {
      db
        .prepare(insertSql)
        .run(
          row.id,
          row.test_run_id,
          row.candidate_path_id,
          row.type,
          row.step_index,
          row.tool_name,
          row.redacted_input,
          row.redacted_output,
          row.content,
          row.created_at,
        );
    },
    insertMany(rows: EvidenceRow[]): void {
      const stmt = db.prepare(insertSql);
      const tx = db.transaction((items: EvidenceRow[]) => {
        for (const r of items)
          stmt.run(
            r.id,
            r.test_run_id,
            r.candidate_path_id,
            r.type,
            r.step_index,
            r.tool_name,
            r.redacted_input,
            r.redacted_output,
            r.content,
            r.created_at,
          );
      });
      tx(rows);
    },
    findByTestRun(testRunId: string): Evidence[] {
      const rows = db
        .prepare(`SELECT * FROM evidence WHERE test_run_id=? ORDER BY created_at ASC`)
        .all(testRunId) as EvidenceRow[];
      return rows.map(rowToEvidence);
    },
    getByCandidatePathId(candidatePathId: string): Evidence[] {
      const rows = db
        .prepare(`SELECT * FROM evidence WHERE candidate_path_id=? ORDER BY created_at ASC`)
        .all(candidatePathId) as EvidenceRow[];
      return rows.map(rowToEvidence);
    },
    getByFindingId(findingId: string): Evidence[] {
      const rows = db
        .prepare(
          `SELECT e.* FROM evidence e
           INNER JOIN findings f ON e.candidate_path_id = f.candidate_path_id
           WHERE f.id=?
           ORDER BY e.created_at ASC`,
        )
        .all(findingId) as EvidenceRow[];
      return rows.map(rowToEvidence);
    },
  };
}
