import { describe, it, expect } from 'vitest';
import { redactValue, redactRecord } from '../redact.js';

describe('redact', () => {
  it('redacts values for credential-like keys', () => {
    const out = redactRecord({ username: 'alice', password: 'hunter2', api_key: 'sk-1' });
    expect(out['username']).toBe('alice');
    expect(out['password']).toMatch(/^\[redacted\]/);
    expect(out['api_key']).toMatch(/^\[redacted\]/);
  });

  it('masks JWT-shaped strings', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmMifQ.signaturepart';
    const out = redactValue(jwt);
    expect(out).toMatch(/\[redacted\]<jwt/);
  });

  it('masks AWS access keys', () => {
    expect(redactValue('AKIAABCDEFGHIJKLMNOP')).toMatch(/aws_key/);
  });

  it('walks nested objects/arrays', () => {
    const out = redactRecord({
      headers: { authorization: 'Bearer xyz', accept: 'json' },
      list: [{ token: 'abc', name: 'ok' }],
    });
    expect((out['headers'] as Record<string, unknown>)['authorization']).toMatch(/redacted/);
    expect((out['headers'] as Record<string, unknown>)['accept']).toBe('json');
    const list = out['list'] as Array<Record<string, unknown>>;
    expect(list[0]?.['token']).toMatch(/redacted/);
    expect(list[0]?.['name']).toBe('ok');
  });

  it('passes plain values through', () => {
    expect(redactValue(42)).toBe(42);
    expect(redactValue(null)).toBe(null);
    expect(redactValue('regular text')).toBe('regular text');
  });
});
