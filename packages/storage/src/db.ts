import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema.js';

let _db: Database.Database | null = null;

export function getDb(path = 'mcphound.db'): Database.Database {
  if (_db) return _db;
  _db = new Database(path);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.exec(SCHEMA_SQL);
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
  return db;
}
