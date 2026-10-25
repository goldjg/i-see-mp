import { afterEach, expect, it, vi } from 'vitest';
import { stdioEnvironment } from '../stdio-env.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each(['BAD=NAME', 'BAD\0NAME', 'BAD\nNAME', '__proto__'])(
  'rejects environment name injection: %j',
  (name) => {
    expect(() => stdioEnvironment({ env: { [name]: 'synthetic-private-value' } })).toThrow(
      'Invalid stdio env or envRefs configuration',
    );
    expect(() => stdioEnvironment({ envRefs: { [name]: 'SOURCE' } })).toThrow(
      'Invalid stdio env or envRefs configuration',
    );
    expect(() => stdioEnvironment({ envRefs: { TARGET: name } })).toThrow(
      'Invalid stdio env or envRefs configuration',
    );
  },
);

it('rejects NUL values without leaking literal or referenced credentials', () => {
  vi.stubGlobal('process', { platform: 'linux', env: { SOURCE: 'synthetic-value\0private' } });
  for (const config of [
    { env: { TARGET: 'synthetic-value\0private' } },
    { envRefs: { TARGET: 'SOURCE' } },
  ]) {
    const error: unknown = (() => {
      try {
        stdioEnvironment(config);
      } catch (error) {
        return error;
      }
      throw new Error('Expected validation failure');
    })();
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain('synthetic-value');
  }
});

it('normalizes Windows names so explicit Path overrides the SDK PATH default', () => {
  vi.stubGlobal('process', { platform: 'win32', env: { SOURCE: 'synthetic-path' } });
  const result = stdioEnvironment({ env: { Path: 'literal-path' }, envRefs: { Path: 'SOURCE' } });
  expect(result.env).toEqual({ PATH: 'synthetic-path' });
});

it('rejects Windows case collisions instead of letting Node choose a value', () => {
  vi.stubGlobal('process', { platform: 'win32', env: { SOURCE: 'synthetic-path' } });
  expect(() =>
    stdioEnvironment({
      env: { Path: 'literal-path' },
      envRefs: { PATH: 'SOURCE' },
    }),
  ).toThrow('Conflicting case-insensitive');
});

it('preserves case-sensitive POSIX names', () => {
  vi.stubGlobal('process', { platform: 'linux', env: {} });
  expect(stdioEnvironment({ env: { TOKEN: 'one', Token: 'two' } }).env).toEqual({
    TOKEN: 'one',
    Token: 'two',
  });
});

it('does not resolve inherited object properties as environment references', () => {
  vi.stubGlobal('process', {
    platform: 'linux',
    env: Object.create({ INHERITED: 'synthetic-private-value' }),
  });
  expect(() => stdioEnvironment({ envRefs: { TARGET: 'INHERITED' } })).toThrow(
    'Missing or empty stdio envRefs',
  );
});
