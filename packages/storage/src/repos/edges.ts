import type Database from 'better-sqlite3';
import type { GraphEdge } from '@mcphound/core';

export interface EdgeRow {
  id: string;
  collection_id: string;
  source: string;
  target: string;
  type: string;
  metadata: string | null; // JSON
  created_at: string;
}

export function createEdgesRepo(db: Database.Database) {
  return {
    upsert(edge: EdgeRow): void {
      db.prepare(
        `INSERT OR REPLACE INTO edges
          (id, collection_id, source, target, type, metadata, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      ).run(
        edge.id,
        edge.collection_id,
        edge.source,
        edge.target,
        edge.type,
        edge.metadata,
        edge.created_at,
      );
    },

    upsertMany(edges: EdgeRow[]): void {
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO edges
          (id, collection_id, source, target, type, metadata, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      );
      const insertMany = db.transaction((rows: EdgeRow[]) => {
        for (const e of rows) {
          stmt.run(e.id, e.collection_id, e.source, e.target, e.type, e.metadata, e.created_at);
        }
      });
      insertMany(edges);
    },

    findByCollection(collectionId: string): GraphEdge[] {
      const rows = db
        .prepare(`SELECT * FROM edges WHERE collection_id=?`)
        .all(collectionId) as EdgeRow[];
      return rows.map((r) => ({
        id: r.id,
        source: r.source,
        target: r.target,
        type: r.type as GraphEdge['type'],
        metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : undefined,
      }));
    },

    deleteByCollection(collectionId: string): void {
      db.prepare(`DELETE FROM edges WHERE collection_id=?`).run(collectionId);
    },
  };
}
