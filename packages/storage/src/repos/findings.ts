import type Database from 'better-sqlite3';
import type { Finding } from '@iseemp/core';

export interface FindingRow {
  id: string;
  collection_id: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  affected_node_ids: string; // JSON
  remediation_hint: string | null;
  created_at: string;
}

export function createFindingsRepo(db: Database.Database) {
  return {
    insert(finding: FindingRow): void {
      db.prepare(
        `INSERT OR REPLACE INTO findings
          (id, collection_id, category, severity, title, description, affected_node_ids, remediation_hint, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(
        finding.id,
        finding.collection_id,
        finding.category,
        finding.severity,
        finding.title,
        finding.description,
        finding.affected_node_ids,
        finding.remediation_hint,
        finding.created_at,
      );
    },

    insertMany(findings: FindingRow[]): void {
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO findings
          (id, collection_id, category, severity, title, description, affected_node_ids, remediation_hint, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      );
      const insertMany = db.transaction((rows: FindingRow[]) => {
        for (const f of rows) {
          stmt.run(f.id, f.collection_id, f.category, f.severity, f.title, f.description, f.affected_node_ids, f.remediation_hint, f.created_at);
        }
      });
      insertMany(findings);
    },

    findByCollection(collectionId: string): Finding[] {
      const rows = db
        .prepare(`SELECT * FROM findings WHERE collection_id=? ORDER BY
          CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`)
        .all(collectionId) as FindingRow[];
      return rows.map((r) => ({
        id: r.id,
        collectionId: r.collection_id,
        category: r.category as Finding['category'],
        severity: r.severity as Finding['severity'],
        title: r.title,
        description: r.description,
        affectedNodeIds: JSON.parse(r.affected_node_ids) as string[],
        remediationHint: r.remediation_hint ?? undefined,
        createdAt: r.created_at,
      }));
    },

    deleteByCollection(collectionId: string): void {
      db.prepare(`DELETE FROM findings WHERE collection_id=?`).run(collectionId);
    },
  };
}
