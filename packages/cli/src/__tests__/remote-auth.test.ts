import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect, discoverConfigs, enumerateServer } from '@iseemp/collector';
import { runTests } from '@iseemp/tester';
import { Capability, remoteRequestOptions } from '@iseemp/core';
import { closeDb, getDb, createServersRepo, createToolsRepo } from '@iseemp/storage';
import { buildServer } from '@iseemp/api';
import { connectServer } from '../../../tester/src/mcp-runtime.js';

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  closeDb();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const requests: Array<{ path: string; method: string; authorization?: string }> = [];
  const streams = new Map<string, ServerResponse>();
  let nextSession = 0;
  const state = { redirect: '', endpoint: '', postRedirect: '', fail: false };
  const server = createServer(async (req, res) => {
    requests.push({
      path: req.url ?? '',
      method: req.method ?? '',
      authorization: req.headers.authorization,
    });
    if (req.url === '/redirect' || (req.method === 'POST' && state.postRedirect)) {
      res.writeHead(307, { location: state.postRedirect || state.redirect }).end();
      return;
    }
    if (state.fail) {
      res.writeHead(400).end(`Rejected ${req.headers.authorization}`);
      return;
    }
    if (req.method === 'GET') {
      if (req.url !== '/sse') {
        res.writeHead(405).end();
        return;
      }
      const session = String(++nextSession);
      streams.set(`/messages/${session}`, res);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`event: endpoint\ndata: ${state.endpoint || `/messages/${session}`}\n\n`);
      req.on('close', () => streams.delete(`/messages/${session}`));
      return;
    }
    let body = '';
    for await (const chunk of req) body += String(chunk);
    const message = JSON.parse(body) as {
      id?: number;
      method: string;
      params?: { protocolVersion?: string };
    };
    if (message.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    const echoedCredential = req.headers.authorization?.split(' ').slice(1).join(' ') ?? 'none';
    let result: unknown = {};
    switch (message.method) {
      case 'initialize':
        result = {
          protocolVersion: message.params?.protocolVersion,
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: 'credential-fixture', version: '1.0.0' },
        };
        break;
      case 'tools/list':
        result = {
          tools: [
            {
              name: 'mutate_remote_state',
              description: `Modify remote state. ${echoedCredential}`,
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        };
        break;
      case 'resources/list':
        result = { resources: [] };
        break;
      case 'prompts/list':
        result = { prompts: [] };
        break;
      case 'tools/call':
        result = { content: [{ type: 'text', text: `result ${echoedCredential}` }] };
        break;
    }
    const reply = JSON.stringify({ jsonrpc: '2.0', id: message.id, result });
    const stream = streams.get(req.url ?? '');
    if (stream) {
      // Split every response to exercise credential redaction across SSE chunks.
      stream.write(`event: message\ndata: ${reply.slice(0, -8)}`);
      setImmediate(() => stream.write(`${reply.slice(-8)}\n\n`));
      res.writeHead(202).end();
    } else {
      res.writeHead(200, { 'content-type': 'application/json' }).end(reply);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture did not bind a TCP port');
  cleanup.push(async () => {
    for (const stream of streams.values()) stream.end();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  return { url: `http://127.0.0.1:${address.port}`, requests, state };
}

async function configFile(mcpServers: Record<string, unknown>) {
  const dir = await mkdtemp(join(tmpdir(), 'iseemp-credentials-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'config.json');
  await writeFile(path, JSON.stringify({ mcpServers }));
  return path;
}

async function collectAndTest(configPath: string) {
  const collectionId = await collect({ configPath, dbPath: ':memory:' });
  // Isolate runtime/auth coverage from classifier heuristics.
  const tools = createToolsRepo(getDb());
  for (const tool of tools.findByCollection(collectionId)) {
    tools.upsert({ ...tool, capabilities: JSON.stringify([Capability.MUTATE_REMOTE_STATE]) });
  }
  const summary = await runTests({ collectionId });
  expect(summary.totalPlanned).toBeGreaterThan(0);
  expect(summary.skipped).toBe(0);
  return { collectionId, summary };
}

describe.each(['http', 'sse'] as const)('%s explicit credential binding', (transport) => {
  const path = transport === 'http' ? '/mcp' : '/sse';

  it('does not send ambient PATs in either collector or tester', async () => {
    vi.stubEnv('GITHUB_PERSONAL_ACCESS_TOKEN', 'synthetic-ambient-pat');
    const remote = await fixture();
    await collectAndTest(
      await configFile({
        unrelated: { url: remote.url + path, transport },
      }),
    );
    expect(remote.requests.filter((r) => r.method === 'POST').length).toBeGreaterThan(4);
    expect(remote.requests.every((r) => r.authorization === undefined)).toBe(true);
  });

  it('keeps distinct credentials bound to their server through persistence and testing', async () => {
    vi.stubEnv('GITHUB_PERSONAL_ACCESS_TOKEN', 'synthetic-ambient-pat');
    vi.stubEnv('ASSESSMENT_ONE', 'synthetic-one-credential');
    vi.stubEnv('ASSESSMENT_TWO', 'synthetic-two-credential');
    const one = await fixture();
    const two = await fixture();
    const configPath = await configFile({
      one: { url: one.url + path, transport, auth: { envVar: 'ASSESSMENT_ONE' } },
      two: { url: two.url + path, transport, auth: { envVar: 'ASSESSMENT_TWO' } },
    });
    const stdout = vi.spyOn(console, 'log');
    const stderr = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    const { collectionId, summary } = await collectAndTest(configPath);
    for (const [remote, token] of [
      [one, 'synthetic-one-credential'],
      [two, 'synthetic-two-credential'],
    ] as const) {
      expect(remote.requests.length).toBeGreaterThan(4);
      expect(remote.requests.every((r) => r.authorization === `Bearer ${token}`)).toBe(true);
    }
    const stored = createServersRepo(getDb()).findByCollection(collectionId);
    expect(stored.map((s) => s.auth)).toEqual([
      '{"envVar":"ASSESSMENT_ONE"}',
      '{"envVar":"ASSESSMENT_TWO"}',
    ]);
    const app = buildServer();
    const apiOutput = await Promise.all(
      ['/servers', '/tools', '/logs', '/test-runs'].map(
        async (url) => (await app.inject(url)).body,
      ),
    );
    await app.close();
    const persisted = ['servers', 'tools', 'test_runs', 'evidence', 'logs'].map((table) =>
      getDb().prepare(`SELECT * FROM ${table}`).all(),
    );
    const observable =
      JSON.stringify({
        persisted,
        summary,
        apiOutput,
        logs: [stdout.mock.calls, stderr.mock.calls, warnings.mock.calls],
      }) + (await readFile(configPath, 'utf8'));
    expect(observable).not.toContain('synthetic-one-credential');
    expect(observable).not.toContain('synthetic-two-credential');
    expect(observable).not.toContain('synthetic-ambient-pat');
    expect(JSON.stringify(persisted)).toContain('[redacted]');

    // Re-resolve on later tester connections, not at config-load/collection time.
    vi.stubEnv('ASSESSMENT_ONE', 'synthetic-rotated-credential');
    one.requests.length = 0;
    await runTests({ collectionId });
    expect(one.requests.length).toBeGreaterThan(0);
    expect(
      one.requests.every((r) => r.authorization === 'Bearer synthetic-rotated-credential'),
    ).toBe(true);
  });

  it('fails missing references clearly and does not substitute the ambient PAT', async () => {
    vi.stubEnv('ASSESSMENT_MISSING', '');
    vi.stubEnv('GITHUB_PERSONAL_ACCESS_TOKEN', 'synthetic-ambient-pat');
    const remote = await fixture();
    const configPath = await configFile({
      missing: { url: remote.url + path, transport, auth: { envVar: 'ASSESSMENT_MISSING' } },
    });
    const [config] = await discoverConfigs({ configPath });
    if (!config) throw new Error('Missing test configuration');
    await expect(enumerateServer(config)).rejects.toThrow(
      'Missing or empty credential environment variable: ASSESSMENT_MISSING',
    );
    expect(remote.requests).toEqual([]);
    vi.stubEnv('ASSESSMENT_MISSING', 'synthetic-temporary-credential');
    const collectionId = await collect({ configPath, dbPath: ':memory:' });
    for (const tool of createToolsRepo(getDb()).findByCollection(collectionId)) {
      createToolsRepo(getDb()).upsert({
        ...tool,
        capabilities: JSON.stringify([Capability.MUTATE_REMOTE_STATE]),
      });
    }
    vi.stubEnv('ASSESSMENT_MISSING', '');
    remote.requests.length = 0;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const summary = await runTests({ collectionId });
    expect(summary.skipped).toBe(summary.totalPlanned);
    expect(summary.totalPlanned).toBeGreaterThan(0);
    expect(JSON.stringify(warning.mock.calls)).toContain('ASSESSMENT_MISSING');
    expect(JSON.stringify(warning.mock.calls)).not.toContain('synthetic-temporary-credential');
    expect(remote.requests).toEqual([]);
  });

  it('preserves explicit per-server Authorization without using the ambient PAT', async () => {
    vi.stubEnv('GITHUB_PERSONAL_ACCESS_TOKEN', 'synthetic-ambient-pat');
    const remote = await fixture();
    await enumerateServer({
      id: 'explicit',
      name: 'explicit',
      url: remote.url + path,
      transport,
      env: { Authorization: 'Basic synthetic-explicit-credential' },
    });
    expect(
      remote.requests.every((r) => r.authorization === 'Basic synthetic-explicit-credential'),
    ).toBe(true);
    expect(remote.requests.length).toBeGreaterThan(0);
  });

  it('blocks credential-bearing redirects without contacting another origin', async () => {
    vi.stubEnv('ASSESSMENT_TOKEN', 'synthetic-bound-credential');
    const source = await fixture();
    const destination = await fixture();
    source.state.redirect = destination.url + path;
    await expect(
      enumerateServer({
        id: 'redirect',
        name: 'redirect',
        url: source.url + '/redirect',
        transport,
        auth: { envVar: 'ASSESSMENT_TOKEN' },
      }),
    ).rejects.toThrow();
    expect(destination.requests).toEqual([]);
    expect(
      source.requests.every((r) => r.authorization === 'Bearer synthetic-bound-credential'),
    ).toBe(true);
  });

  it('rejects cross-origin redirects without authentication in both runtime paths', async () => {
    const source = await fixture();
    const destination = await fixture();
    source.state.redirect = destination.url + path;
    const config = {
      id: 'redirect',
      name: 'redirect',
      url: source.url + '/redirect',
      transport,
    };
    await expect(enumerateServer(config)).rejects.toThrow();
    await expect(connectServer(config)).rejects.toThrow();
    expect(source.requests.length).toBeGreaterThanOrEqual(2);
    expect(destination.requests).toEqual([]);
  });

  it('keeps authenticated same-origin redirects blocked despite the SDK default', async () => {
    vi.stubEnv('ASSESSMENT_TOKEN', 'synthetic-bound-credential');
    const source = await fixture();
    source.state.redirect = source.url + path;
    const config = {
      id: 'redirect',
      name: 'redirect',
      url: source.url + '/redirect',
      transport,
      auth: { envVar: 'ASSESSMENT_TOKEN' },
    };
    await expect(enumerateServer(config)).rejects.toThrow();
    await expect(connectServer(config)).rejects.toThrow();
    expect(source.requests.length).toBeGreaterThanOrEqual(2);
    expect(source.requests.every((request) => request.path === '/redirect')).toBe(true);
  });

  it('preserves unauthenticated same-origin redirects in both runtime paths', async () => {
    const source = await fixture();
    source.state.redirect = source.url + path;
    const config = {
      id: 'redirect',
      name: 'redirect',
      url: source.url + '/redirect',
      transport,
    };
    const inventory = await enumerateServer(config);
    expect(inventory.tools[0]?.name).toBe('mutate_remote_state');
    const connection = await connectServer(config);
    await connection.close();
    expect(source.requests.some((request) => request.path === path)).toBe(true);
    expect(source.requests.every((request) => request.authorization === undefined)).toBe(true);
  });

  it('redacts credentials reflected in remote error messages', async () => {
    vi.stubEnv('ASSESSMENT_TOKEN', 'synthetic-reflected-credential');
    const remote = await fixture();
    remote.state.fail = true;
    const error = await enumerateServer({
      id: 'fail',
      name: 'fail',
      url: remote.url + path,
      transport,
      auth: { envVar: 'ASSESSMENT_TOKEN' },
    }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain('synthetic-reflected-credential');
  });
});

it('blocks cross-origin SSE endpoint announcements and message POST redirects', async () => {
  vi.stubEnv('ASSESSMENT_TOKEN', 'synthetic-sse-credential');
  const source = await fixture();
  const destination = await fixture();
  const config = {
    id: 'sse',
    name: 'sse',
    url: source.url + '/sse',
    transport: 'sse' as const,
    auth: { envVar: 'ASSESSMENT_TOKEN' },
  };
  source.state.endpoint = destination.url + '/messages';
  await expect(enumerateServer(config)).rejects.toThrow('origin');
  source.state.endpoint = '';
  source.state.postRedirect = destination.url + '/messages';
  await expect(enumerateServer(config)).rejects.toThrow('redirect');
  expect(destination.requests).toEqual([]);
});

it('enforces the same origin even if a transport attempts a fallback URL', async () => {
  vi.stubEnv('ASSESSMENT_TOKEN', 'synthetic-bound-credential');
  const source = await fixture();
  const destination = await fixture();
  const options = remoteRequestOptions(new URL(source.url), {
    auth: { envVar: 'ASSESSMENT_TOKEN' },
  });
  if (!options.fetch) throw new Error('Missing bound fetch');
  await expect(options.fetch(destination.url)).rejects.toThrow('outside the configured origin');
  expect(destination.requests).toEqual([]);
});

it('scopes stdio references in collector and tester independently of remote auth', async () => {
  vi.stubEnv('STDIO_EXPLICIT', 'process-value');
  vi.stubEnv('STDIO_INHERITED', 'inherited-value');
  const configPath = await configFile({
    stdio: {
      command: process.execPath,
      args: [fileURLToPath(new URL('./fixtures/credential-stdio.mjs', import.meta.url))],
      envRefs: { STDIO_EXPLICIT: 'STDIO_EXPLICIT' },
      // Remote authentication must not be evaluated for stdio transports.
      auth: { envVar: 'UNSET_AND_IRRELEVANT_FOR_STDIO' },
    },
  });
  const { collectionId, summary } = await collectAndTest(configPath);
  const tools = createToolsRepo(getDb()).findByCollection(collectionId);
  expect(tools[0]?.description).toContain('[redacted]');
  expect(JSON.stringify(summary.testRuns)).toContain('missing');
  expect(JSON.stringify(summary.testRuns)).not.toContain('inherited-value');
  expect(JSON.stringify(summary.testRuns)).not.toContain('process-value');
});
