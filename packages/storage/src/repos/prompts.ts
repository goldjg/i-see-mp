import type Database from 'better-sqlite3';

export interface PromptRow {
  id: string;
  collection_id: string;
  server_id: string;
  name: string;
  description: string | null;
  arguments: string | null; // JSON
  created_at: string;
}

export function createPromptsRepo(db: Database.Database) {
  return {
    upsert(prompt: PromptRow): void {
      db.prepare(
        `INSERT OR REPLACE INTO prompts
          (id, collection_id, server_id, name, description, arguments, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      ).run(
        prompt.id,
        prompt.collection_id,
        prompt.server_id,
        prompt.name,
        prompt.description,
        prompt.arguments,
        prompt.created_at,
      );
    },

    findByServer(serverId: string): PromptRow[] {
      return db.prepare(`SELECT * FROM prompts WHERE server_id=?`).all(serverId) as PromptRow[];
    },

    findByCollection(collectionId: string): PromptRow[] {
      return db
        .prepare(`SELECT * FROM prompts WHERE collection_id=?`)
        .all(collectionId) as PromptRow[];
    },
  };
}
