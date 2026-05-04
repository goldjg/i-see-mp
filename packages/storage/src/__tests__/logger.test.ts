import { describe, it, expect } from 'vitest';
import { createMemoryDb } from '../db.js';
import { createLogsRepo } from '../repos/logs.js';
import { log } from '../logger.js';

describe('log helper', () => {
  it('redacts sensitive detail keys and values before persistence', () => {
    const db = createMemoryDb();
    log(db, {
      level: 'info',
      phase: 'test',
      eventType: 'test.sample',
      message: 'sample',
      details: {
        Authorization: 'Bearer secret-token',
        github_token: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
        safe: 'ok',
      },
    });

    const logs = createLogsRepo(db).query({});
    expect(logs.total).toBe(1);
    const entry = logs.items[0];
    expect(entry?.redacted).toBe(true);
    const details = JSON.parse(entry?.detailsJson ?? '{}') as Record<string, string>;
    expect(details.Authorization).toBe('[REDACTED]');
    expect(details.github_token).toBe('[REDACTED]');
    expect(details.safe).toBe('ok');
  });
});
