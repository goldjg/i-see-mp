import type Database from 'better-sqlite3';
import type { Collection } from '@iseemp/core';

export interface CollectionRow {
  id: string;
  started_at: string;
  completed_at: string | null;
  server_count: number;
  tool_count: number;
  resource_count: number;
  prompt_count: number;
  status: string;
  error: string | null;
}

function rowToCollection(row: CollectionRow): Collection {
  return {
    id: row.id,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    serverCount: row.server_count,
    toolCount: row.tool_count,
    resourceCount: row.resource_count,
    promptCount: row.prompt_count,
    status: row.status as Collection['status'],
    error: row.error ?? undefined,
  };
}

export function createCollectionsRepo(db: Database.Database) {
  return {
    create(id: string, startedAt: string): void {
      db.prepare(
        `INSERT INTO collections (id, started_at, status) VALUES (?, ?, 'running')`,
      ).run(id, startedAt);
    },

    complete(
      id: string,
      counts: {
        serverCount: number;
        toolCount: number;
        resourceCount: number;
        promptCount: number;
      },
    ): void {
      db.prepare(
        `UPDATE collections SET status='completed', completed_at=?, server_count=?, tool_count=?, resource_count=?, prompt_count=? WHERE id=?`,
      ).run(
        new Date().toISOString(),
        counts.serverCount,
        counts.toolCount,
        counts.resourceCount,
        counts.promptCount,
        id,
      );
    },

    fail(id: string, error: string): void {
      db.prepare(
        `UPDATE collections SET status='failed', completed_at=?, error=? WHERE id=?`,
      ).run(new Date().toISOString(), error, id);
    },

    findById(id: string): Collection | undefined {
      const row = db
        .prepare(`SELECT * FROM collections WHERE id=?`)
        .get(id) as CollectionRow | undefined;
      return row ? rowToCollection(row) : undefined;
    },

    list(): Collection[] {
      const rows = db
        .prepare(`SELECT * FROM collections ORDER BY started_at DESC`)
        .all() as CollectionRow[];
      return rows.map(rowToCollection);
    },

    latest(): Collection | undefined {
      const row = db
        .prepare(`SELECT * FROM collections ORDER BY started_at DESC LIMIT 1`)
        .get() as CollectionRow | undefined;
      return row ? rowToCollection(row) : undefined;
    },
  };
}
