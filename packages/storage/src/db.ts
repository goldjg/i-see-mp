import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema.js';

const FINDINGS_NEW_COLUMNS: Array<[string, string]> = [
  ['affected_edge_ids', 'TEXT'],
  ['confidence', 'TEXT'],
  ['static_possible', 'INTEGER'],
  ['observed', 'INTEGER'],
  ['tested', 'INTEGER'],
  ['path_status', 'TEXT'],
  ['test_run_ids', 'TEXT'],
  ['candidate_path_id', 'TEXT'],
  ['path_summary', 'TEXT'],
  ['source_capabilities', 'TEXT'],
  ['sink_capabilities', 'TEXT'],
  ['boundary_crossed', 'TEXT'],
  ['is_cross_server', 'INTEGER'],
  ['source_server_id', 'TEXT'],
  ['sink_server_id', 'TEXT'],
  ['explanation', 'TEXT'],
  ['evidence', 'TEXT'],
];

const TEST_RUNS_NEW_COLUMNS: Array<[string, string]> = [
  ['candidate_path_id', 'TEXT'],
  ['server_id', 'TEXT'],
  ['source_tool_id', 'TEXT'],
  ['sink_tool_id', 'TEXT'],
  ['outcome', 'TEXT'],
];

const EVIDENCE_NEW_COLUMNS: Array<[string, string]> = [
  ['candidate_path_id', 'TEXT'],
  ['step_index', 'INTEGER'],
  ['tool_name', 'TEXT'],
  ['redacted_input', 'TEXT'],
  ['redacted_output', 'TEXT'],
];

const TEST_RUN_REQUIRED_COLUMNS = [
  'profile',
  'test_case_id',
  'test_case_name',
  'plan',
  'tool_calls',
  'canary_observed',
  'path_status',
];

function migrate(db: Database.Database): void {
  function ensureColumns(table: string, columns: Array<[string, string]>): void {
    const tableCols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    const tableExisting = new Set(tableCols.map((c) => c.name));
    for (const [col, type] of columns) {
      if (!tableExisting.has(col)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
      }
    }
  }

  // Ensure new findings columns exist on legacy databases (idempotent)
  ensureColumns('findings', FINDINGS_NEW_COLUMNS);

  // Legacy test_runs table (reserved/unused in MVP) had a different shape.
  // If the new required columns aren't present, drop and let SCHEMA_SQL recreate it.
  const trCols = db.prepare(`PRAGMA table_info(test_runs)`).all() as Array<{ name: string }>;
  if (trCols.length > 0) {
    const trExisting = new Set(trCols.map((c) => c.name));
    const missingRequired = TEST_RUN_REQUIRED_COLUMNS.some((c) => !trExisting.has(c));
    if (missingRequired) {
      // Best-effort: drop dependent evidence rows and the legacy table.
      db.exec(`DROP TABLE IF EXISTS evidence`);
      db.exec(`DROP TABLE IF EXISTS test_runs`);
      db.exec(SCHEMA_SQL);
    }
  }

  ensureColumns('test_runs', TEST_RUNS_NEW_COLUMNS);
  ensureColumns('evidence', EVIDENCE_NEW_COLUMNS);
}

let _db: Database.Database | null = null;

export function getDb(path = 'iseemp.db'): Database.Database {
  if (_db) return _db;
  _db = new Database(path);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.exec(SCHEMA_SQL);
  migrate(_db);
  return _db;
}

export function resetDb(path?: string): Database.Database {
  if (_db) {
    _db.close();
    _db = null;
  }
  return getDb(path);
}

export function closeDb(): void {
  _db?.close();
  _db = null;
}

/** Create a fresh in-memory DB instance (for tests). */
export function createMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  migrate(db);
  return db;
}
