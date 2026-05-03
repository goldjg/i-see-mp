import type Database from 'better-sqlite3';

export interface ToolRow {
  id: string;
  collection_id: string;
  server_id: string;
  name: string;
  description: string | null;
  input_schema: string | null; // JSON
  capabilities: string; // JSON array
  source_role: string; // JSON array of SourceRole
  is_untrusted: number; // bool-ish
  is_instruction_capable: number; // bool-ish
  content_origin: string;
  risk_score: number;
  created_at: string;
}

export function createToolsRepo(db: Database.Database) {
  return {
    upsert(tool: ToolRow): void {
      db.prepare(
        `INSERT OR REPLACE INTO tools
          (id, collection_id, server_id, name, description, input_schema, capabilities, source_role, is_untrusted, is_instruction_capable, content_origin, risk_score, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        tool.id,
        tool.collection_id,
        tool.server_id,
        tool.name,
        tool.description,
        tool.input_schema,
        tool.capabilities,
        tool.source_role,
        tool.is_untrusted,
        tool.is_instruction_capable,
        tool.content_origin,
        tool.risk_score,
        tool.created_at,
      );
    },

    findByServer(serverId: string): ToolRow[] {
      return db
        .prepare(`SELECT * FROM tools WHERE server_id=?`)
        .all(serverId) as ToolRow[];
    },

    findByCollection(collectionId: string): ToolRow[] {
      return db
        .prepare(`SELECT * FROM tools WHERE collection_id=?`)
        .all(collectionId) as ToolRow[];
    },

    findById(id: string): ToolRow | undefined {
      return db.prepare(`SELECT * FROM tools WHERE id=?`).get(id) as ToolRow | undefined;
    },
  };
}
