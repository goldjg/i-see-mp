import type Database from 'better-sqlite3';
import type { GraphNode } from '@mcphound/core';

export interface NodeRow {
  id: string;
  collection_id: string;
  type: string;
  label: string;
  server_id: string | null;
  capabilities: string; // JSON array
  risk_score: number;
  metadata: string | null; // JSON
  created_at: string;
}

export function createNodesRepo(db: Database.Database) {
  return {
    upsert(node: NodeRow): void {
      db.prepare(
        `INSERT OR REPLACE INTO nodes
          (id, collection_id, type, label, server_id, capabilities, risk_score, metadata, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(
        node.id,
        node.collection_id,
        node.type,
        node.label,
        node.server_id,
        node.capabilities,
        node.risk_score,
        node.metadata,
        node.created_at,
      );
    },

    upsertMany(nodes: NodeRow[]): void {
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO nodes
          (id, collection_id, type, label, server_id, capabilities, risk_score, metadata, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      );
      const insertMany = db.transaction((rows: NodeRow[]) => {
        for (const n of rows) {
          stmt.run(n.id, n.collection_id, n.type, n.label, n.server_id, n.capabilities, n.risk_score, n.metadata, n.created_at);
        }
      });
      insertMany(nodes);
    },

    findByCollection(collectionId: string): GraphNode[] {
      const rows = db
        .prepare(`SELECT * FROM nodes WHERE collection_id=?`)
        .all(collectionId) as NodeRow[];
      return rows.map((r) => ({
        id: r.id,
        type: r.type as GraphNode['type'],
        label: r.label,
        serverId: r.server_id ?? undefined,
        capabilities: JSON.parse(r.capabilities) as GraphNode['capabilities'],
        riskScore: r.risk_score,
        metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : undefined,
      }));
    },

    deleteByCollection(collectionId: string): void {
      db.prepare(`DELETE FROM nodes WHERE collection_id=?`).run(collectionId);
    },
  };
}
