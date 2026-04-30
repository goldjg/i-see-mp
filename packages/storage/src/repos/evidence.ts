import type Database from 'better-sqlite3';
import type { Evidence } from '@iseemp/core';

export interface EvidenceRow {
  id: string;
  test_run_id: string;
  type: string;
  content: string; // JSON
  created_at: string;
}

function rowToEvidence(r: EvidenceRow): Evidence {
  return {
    id: r.id,
    testRunId: r.test_run_id,
    type: r.type,
    content: JSON.parse(r.content) as Record<string, unknown>,
    createdAt: r.created_at,
  };
}

export function evidenceToRow(e: Evidence): EvidenceRow {
  return {
    id: e.id,
    test_run_id: e.testRunId,
    type: e.type,
    content: JSON.stringify(e.content),
    created_at: e.createdAt,
  };
}

export function createEvidenceRepo(db: Database.Database) {
  const insertSql = `INSERT OR REPLACE INTO evidence (id, test_run_id, type, content, created_at) VALUES (?,?,?,?,?)`;
  return {
    insert(row: EvidenceRow): void {
      db.prepare(insertSql).run(row.id, row.test_run_id, row.type, row.content, row.created_at);
    },
    insertMany(rows: EvidenceRow[]): void {
      const stmt = db.prepare(insertSql);
      const tx = db.transaction((items: EvidenceRow[]) => {
        for (const r of items) stmt.run(r.id, r.test_run_id, r.type, r.content, r.created_at);
      });
      tx(rows);
    },
    findByTestRun(testRunId: string): Evidence[] {
      const rows = db
        .prepare(`SELECT * FROM evidence WHERE test_run_id=? ORDER BY created_at ASC`)
        .all(testRunId) as EvidenceRow[];
      return rows.map(rowToEvidence);
    },
  };
}
