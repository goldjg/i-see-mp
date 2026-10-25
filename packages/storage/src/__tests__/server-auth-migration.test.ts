import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb, resetDb } from '../db.js';
import { SCHEMA_SQL } from '../schema.js';

it('adds a nullable auth reference to an existing database without changing its rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'iseemp-auth-migration-'));
  const path = join(dir, 'legacy.db');
  try {
    const legacy = new Database(path);
    legacy.exec(SCHEMA_SQL.replace('  auth TEXT,\n', ''));
    legacy.exec(`
      INSERT INTO collections (id, started_at) VALUES ('legacy', '2026-01-01');
      INSERT INTO servers (id, collection_id, name, transport, env, created_at)
      VALUES ('server', 'legacy', 'legacy-server', 'http',
        '{"GITHUB_PERSONAL_ACCESS_TOKEN":"[redacted]"}', '2026-01-01')
    `);
    legacy.close();
    const db = resetDb(path);
    expect(db.prepare('SELECT auth, env FROM servers').get()).toEqual({
      auth: null,
      env: '{"GITHUB_PERSONAL_ACCESS_TOKEN":"[redacted]"}',
    });
    closeDb();
    // Running the migration again is harmless.
    expect(resetDb(path).prepare('SELECT count(*) AS count FROM servers').get()).toEqual({
      count: 1,
    });
  } finally {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  }
});
