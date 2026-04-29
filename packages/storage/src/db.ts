import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema.js';

const FINDINGS_NEW_COLUMNS: Array<[string, string]> = [
  ['affected_edge_ids', 'TEXT'],
  ['confidence', 'TEXT'],
  ['static_possible', 'INTEGER'],
  ['observed', 'INTEGER'],
  ['tested', 'INTEGER'],
  ['path_summary', 'TEXT'],
  ['source_capabilities', 'TEXT'],
  ['sink_capabilities', 'TEXT'],
  ['boundary_crossed', 'TEXT'],
  ['explanation', 'TEXT'],
  ['evidence', 'TEXT'],
];

function migrate(db: Database.Database): void {
  // Ensure new findings columns exist on legacy databases (idempotent)
  const cols = db.prepare(`PRAGMA table_info(findings)`).all() as Array<{ name: string }>;
  const existing = new Set(cols.map((c) => c.name));
  for (const [col, type] of FINDINGS_NEW_COLUMNS) {
    if (!existing.has(col)) {
      db.exec(`ALTER TABLE findings ADD COLUMN ${col} ${type}`);
    }
  }
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
