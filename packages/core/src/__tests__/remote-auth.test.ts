import { afterEach, describe, expect, it, vi } from 'vitest';
import { remoteRequestOptions } from '../remote-auth.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('remoteRequestOptions', () => {
  it('does not resolve references until connection options are built', async () => {
    vi.stubEnv('MCP_BOUND_TOKEN', 'synthetic-runtime-token');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const options = remoteRequestOptions(new URL('https://custom.example/mcp'), {
      auth: { envVar: 'MCP_BOUND_TOKEN' },
      env: { Authorization: 'Basic ignored-explicit-value' },
    });
    await options.fetch?.('https://custom.example/mcp');
    expect(fetchMock.mock.calls[0]?.[1].headers.get('authorization')).toBe(
      'Bearer synthetic-runtime-token',
    );
  });

  it('preserves an explicitly server-scoped legacy PAT', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const options = remoteRequestOptions(new URL('http://custom.example/mcp'), {
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'synthetic-configured-pat' },
    });
    await options.fetch?.('http://custom.example/mcp');
    expect(fetchMock.mock.calls[0]?.[1].headers.get('authorization')).toBe(
      'Bearer synthetic-configured-pat',
    );
  });

  it.each(['', 'bad\nheader', '[redacted]', 'x'.repeat(8193)])(
    'rejects invalid explicit credentials without exposing values',
    (authorization) => {
      expect(() =>
        remoteRequestOptions(new URL('https://custom.example'), {
          env: { Authorization: authorization },
        }),
      ).toThrow('Invalid explicit remote Authorization credential');
    },
  );

  it('rejects invalid bearer values without leaking them through Headers errors', () => {
    vi.stubEnv('MCP_BOUND_TOKEN', 'synthetic-invalid\ncredential');
    expect(() =>
      remoteRequestOptions(new URL('https://custom.example'), {
        auth: { envVar: 'MCP_BOUND_TOKEN' },
      }),
    ).toThrow('Invalid bearer credential in auth.envVar');
  });

  it('rejects redirects even on the same origin, and sanitizes native fetch errors', async () => {
    vi.stubEnv('MCP_BOUND_TOKEN', 'synthetic-runtime-token');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/other' } }))
      .mockRejectedValueOnce(new Error('synthetic-runtime-token'));
    vi.stubGlobal('fetch', fetchMock);
    const options = remoteRequestOptions(new URL('https://custom.example/mcp'), {
      auth: { envVar: 'MCP_BOUND_TOKEN' },
    });
    await expect(options.fetch?.('https://custom.example/mcp')).rejects.toThrow('Blocked redirect');
    expect(fetchMock.mock.calls[0]?.[1].redirect).toBe('manual');
    await expect(options.fetch?.('https://custom.example/mcp')).rejects.toThrow(
      'Credential-bearing MCP request failed',
    );
  });

  it('redacts secrets at every possible stream chunk boundary without buffering complete SSE events', async () => {
    vi.stubEnv('MCP_BOUND_TOKEN', 'synthetic-split-secret');
    const text = 'data: {"result":"synthetic-split-secret"}\n\n';
    const encoder = new TextEncoder();
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (const char of text) controller.enqueue(encoder.encode(char));
              controller.close();
            },
          }),
          { headers: { 'x-reflection': 'synthetic-split-secret' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const options = remoteRequestOptions(new URL('https://custom.example/mcp'), {
      auth: { envVar: 'MCP_BOUND_TOKEN' },
    });
    const response = await options.fetch?.('https://custom.example/mcp');
    expect(await response?.text()).toBe('data: {"result":"[redacted]"}\n\n');
    expect(response?.headers.get('x-reflection')).toBe('[redacted]');
  });

  it('keeps unauthenticated arbitrary endpoints on native fetch semantics', () => {
    vi.stubEnv('GITHUB_PERSONAL_ACCESS_TOKEN', 'synthetic-ambient-pat');
    expect(remoteRequestOptions(new URL('http://arbitrary.example'), {})).toEqual({});
  });
});
