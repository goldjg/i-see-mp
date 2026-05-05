import type Database from 'better-sqlite3';

export interface LogRow {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  phase: 'collect' | 'analyze' | 'test' | 'serve' | 'demo';
  collection_id: string | null;
  server_id: string | null;
  tool_id: string | null;
  finding_id: string | null;
  test_run_id: string | null;
  event_type: string;
  message: string;
  details_json: string | null;
  redacted: number;
}

export interface LogRecord {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  phase: 'collect' | 'analyze' | 'test' | 'serve' | 'demo';
  collectionId: string | null;
  serverId: string | null;
  toolId: string | null;
  findingId: string | null;
  testRunId: string | null;
  eventType: string;
  message: string;
  detailsJson: string | null;
  redacted: boolean;
}

export interface LogQuery {
  collectionId?: string;
  findingId?: string;
  testRunId?: string;
  serverId?: string;
  toolId?: string;
  phase?: string;
  level?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

function rowToRecord(row: LogRow): LogRecord {
  return {
    id: row.id,
    timestamp: row.timestamp,
    level: row.level,
    phase: row.phase,
    collectionId: row.collection_id,
    serverId: row.server_id,
    toolId: row.tool_id,
    findingId: row.finding_id,
    testRunId: row.test_run_id,
    eventType: row.event_type,
    message: row.message,
    detailsJson: row.details_json,
    redacted: row.redacted === 1,
  };
}

export function createLogsRepo(db: Database.Database) {
  const insertSql =
    'INSERT INTO logs (id, timestamp, level, phase, collection_id, server_id, tool_id, finding_id, test_run_id, event_type, message, details_json, redacted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)';

  return {
    insert(row: LogRow): void {
      db.prepare(insertSql).run(
        row.id,
        row.timestamp,
        row.level,
        row.phase,
        row.collection_id,
        row.server_id,
        row.tool_id,
        row.finding_id,
        row.test_run_id,
        row.event_type,
        row.message,
        row.details_json,
        row.redacted,
      );
    },

    query(filters: LogQuery): { items: LogRecord[]; total: number } {
      const whereParts: string[] = [];
      const params: unknown[] = [];

      if (filters.collectionId) {
        whereParts.push('collection_id = ?');
        params.push(filters.collectionId);
      }
      if (filters.findingId) {
        whereParts.push('finding_id = ?');
        params.push(filters.findingId);
      }
      if (filters.testRunId) {
        whereParts.push('test_run_id = ?');
        params.push(filters.testRunId);
      }
      if (filters.serverId) {
        whereParts.push('server_id = ?');
        params.push(filters.serverId);
      }
      if (filters.toolId) {
        whereParts.push('tool_id = ?');
        params.push(filters.toolId);
      }
      if (filters.phase) {
        whereParts.push('phase = ?');
        params.push(filters.phase);
      }
      if (filters.level) {
        whereParts.push('level = ?');
        params.push(filters.level);
      }
      if (filters.q) {
        whereParts.push('message LIKE ?');
        params.push(`%${filters.q}%`);
      }

      const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
      const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
      const offset = Math.max(filters.offset ?? 0, 0);

      const totalRow = db
        .prepare(`SELECT COUNT(*) as total FROM logs ${whereSql}`)
        .get(...params) as { total: number };
      const rows = db
        .prepare(`SELECT * FROM logs ${whereSql} ORDER BY timestamp DESC LIMIT ? OFFSET ?`)
        .all(...params, limit, offset) as LogRow[];

      return {
        items: rows.map(rowToRecord),
        total: totalRow.total,
      };
    },
  };
}
