import type Database from 'better-sqlite3';

export interface ServerRow {
  id: string;
  collection_id: string;
  name: string;
  url: string | null;
  command: string | null;
  args: string | null; // JSON
  env: string | null; // JSON
  transport: string;
  is_verified: number;
  created_at: string;
}

export function createServersRepo(db: Database.Database) {
  return {
    upsert(server: ServerRow): void {
      db.prepare(
        `INSERT OR REPLACE INTO servers
          (id, collection_id, name, url, command, args, env, transport, is_verified, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        server.id,
        server.collection_id,
        server.name,
        server.url,
        server.command,
        server.args,
        server.env,
        server.transport,
        server.is_verified,
        server.created_at,
      );
    },

    findByCollection(collectionId: string): ServerRow[] {
      return db
        .prepare(`SELECT * FROM servers WHERE collection_id=?`)
        .all(collectionId) as ServerRow[];
    },

    findById(id: string): ServerRow | undefined {
      return db.prepare(`SELECT * FROM servers WHERE id=?`).get(id) as ServerRow | undefined;
    },
  };
}
