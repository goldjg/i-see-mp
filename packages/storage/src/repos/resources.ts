import type Database from 'better-sqlite3';

export interface ResourceRow {
  id: string;
  collection_id: string;
  server_id: string;
  uri: string;
  name: string | null;
  description: string | null;
  mime_type: string | null;
  created_at: string;
}

export function createResourcesRepo(db: Database.Database) {
  return {
    upsert(resource: ResourceRow): void {
      db.prepare(
        `INSERT OR REPLACE INTO resources
          (id, collection_id, server_id, uri, name, description, mime_type, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      ).run(
        resource.id,
        resource.collection_id,
        resource.server_id,
        resource.uri,
        resource.name,
        resource.description,
        resource.mime_type,
        resource.created_at,
      );
    },

    findByServer(serverId: string): ResourceRow[] {
      return db
        .prepare(`SELECT * FROM resources WHERE server_id=?`)
        .all(serverId) as ResourceRow[];
    },

    findByCollection(collectionId: string): ResourceRow[] {
      return db
        .prepare(`SELECT * FROM resources WHERE collection_id=?`)
        .all(collectionId) as ResourceRow[];
    },
  };
}
