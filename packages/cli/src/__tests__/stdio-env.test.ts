import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Capability, type ServerConfig } from '@iseemp/core';
import { collect, discoverConfigs, enumerateServer } from '@iseemp/collector';
import { runTests } from '@iseemp/tester';
import { closeDb, createServersRepo, createToolsRepo, getDb } from '@iseemp/storage';
import { connectServer, callTool } from '../../../tester/src/mcp-runtime.js';

const fixturePath = fileURLToPath(new URL('./fixtures/environment-stdio.mjs', import.meta.url));
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  closeDb();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    id: 'fixture',
    name: 'fixture',
    transport: 'stdio',
    command: process.execPath,
    args: [fixturePath],
    ...overrides,
  };
}

async function configFile(mcpServers: Record<string, unknown>) {
  const dir = await mkdtemp(join(tmpdir(), 'iseemp-stdio-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'config.json');
  await writeFile(path, JSON.stringify({ mcpServers }));
  return path;
}

async function reports(server: ServerConfig) {
  const inventory = await enumerateServer(server);
  const connection = await connectServer(server);
  try {
    const result = await callTool(connection.client, 'mutate_remote_state', {});
    const description = inventory.tools[0]?.description;
    if (!description) throw new Error('Fixture description missing');
    return [
      JSON.parse(description.slice('Modify remote state. '.length)) as Record<string, boolean>,
      JSON.parse(result.text) as Record<string, boolean>,
    ];
  } finally {
    await connection.close();
  }
}

describe('real stdio subprocess environment', () => {
  it.each<Record<string, string> | undefined>([
    undefined,
    {},
    { STDIO_SETTING: 'literal-override' },
  ])('never forwards ambient credentials with env=%j', async (env) => {
    vi.stubEnv('GITHUB_PERSONAL_ACCESS_TOKEN', 'synthetic-ambient-pat');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'synthetic-cloud-secret');
    vi.stubEnv('STDIO_PARENT_SETTING', 'synthetic-parent-setting');
    for (const report of await reports(config({ env }))) {
      expect(report).toMatchObject({
        ambientPat: false,
        ambientCloud: false,
        parentSetting: false,
        runtimePath: true,
        runtimeHome: true,
      });
    }
  });

  it('retains explicit overrides, empty values, executable discovery and literal non-interpolation', async () => {
    vi.stubEnv('STDIO_SETTING', 'parent-setting');
    vi.stubEnv('STDIO_PARENT_SETTING', 'synthetic-parent-setting');
    for (const report of await reports(
      config({
        command: process.platform === 'win32' ? 'node.exe' : 'node',
        env: {
          PATH: dirname(process.execPath),
          STDIO_EXPECTED_PATH: dirname(process.execPath),
          STDIO_SETTING: 'literal-override',
          STDIO_EMPTY: '',
          STDIO_LITERAL: '${STDIO_PARENT_SETTING}',
        },
      }),
    )) {
      expect(report).toMatchObject({
        explicitOverride: true,
        pathOverride: true,
        literalUnexpanded: true,
        emptyOverride: true,
      });
    }
  });

  it('binds explicit references to one server, with references overriding literals', async () => {
    vi.stubEnv('ASSESSMENT_ONE', 'synthetic-one-credential');
    vi.stubEnv('ASSESSMENT_TWO', 'synthetic-two-credential');
    for (const report of await reports(
      config({
        env: { STDIO_SETTING: 'literal-override' },
        envRefs: { SERVER_TOKEN: 'ASSESSMENT_ONE', STDIO_SETTING: 'ASSESSMENT_ONE' },
      }),
    )) {
      expect(report).toMatchObject({
        tokenOne: true,
        tokenTwo: false,
        sourceOne: false,
        sourceTwo: false,
        explicitOverride: false,
        referenceOverride: true,
      });
    }
    for (const report of await reports(
      config({
        envRefs: { SERVER_TWO_TOKEN: 'ASSESSMENT_TWO' },
      }),
    )) {
      expect(report).toMatchObject({
        tokenOne: false,
        tokenTwo: true,
        sourceOne: false,
        sourceTwo: false,
      });
    }
  });

  it('forwards a GitHub PAT only when explicitly authorized for that child', async () => {
    vi.stubEnv('GITHUB_PERSONAL_ACCESS_TOKEN', 'synthetic-ambient-pat');
    for (const report of await reports(
      config({
        envRefs: { GITHUB_PERSONAL_ACCESS_TOKEN: 'GITHUB_PERSONAL_ACCESS_TOKEN' },
      }),
    )) {
      expect(report.ambientPat).toBe(true);
    }
    for (const report of await reports(config())) expect(report.ambientPat).toBe(false);
  });

  it.each([undefined, ''])('fails closed for a missing or empty reference (%s)', async (value) => {
    vi.stubEnv('STDIO_MISSING', value);
    const server = config({ envRefs: { SERVER_TOKEN: 'STDIO_MISSING' } });
    await expect(enumerateServer(server)).rejects.toThrow('Missing or empty stdio envRefs');
    await expect(connectServer(server)).rejects.toThrow('Missing or empty stdio envRefs');
  });

  it('closes oversized stdio streams in both runtime paths with the SDK buffer limit', async () => {
    const server = config({ args: [fixturePath, 'oversized'] });
    await expect(enumerateServer(server)).rejects.toThrow(/maximum size|Connection closed/);
    await expect(connectServer(server)).rejects.toThrow(/maximum size|Connection closed/);
  });

  it('redacts reflected metadata, tool results and protocol exceptions', async () => {
    vi.stubEnv('ASSESSMENT_ONE', 'synthetic-one-credential');
    const envRefs = { SERVER_TOKEN: 'ASSESSMENT_ONE' };
    const inventory = await enumerateServer(config({ envRefs, args: [fixturePath, 'reflect'] }));
    expect(JSON.stringify(inventory)).toContain('[redacted]');
    expect(JSON.stringify(inventory)).not.toContain('synthetic-one-credential');
    const connection = await connectServer(config({ envRefs, args: [fixturePath, 'reflect'] }));
    try {
      const result = await callTool(connection.client, 'mutate_remote_state', {});
      expect(JSON.stringify(result)).not.toContain('synthetic-one-credential');
      expect(result.text).toContain('[redacted]');
    } finally {
      await connection.close();
    }
    for (const launch of [enumerateServer, connectServer]) {
      await expect(
        launch(config({ envRefs, args: [fixturePath, 'initialize-error'] })),
      ).rejects.toThrow('fixture failure [redacted]');
    }
    const errorInventory = await enumerateServer(
      config({ envRefs, args: [fixturePath, 'error-after-init'] }),
    );
    expect(errorInventory.errors?.tools).toContain('fixture failure [redacted]');
    expect(JSON.stringify(errorInventory)).not.toContain('synthetic-one-credential');
    const failing = await connectServer(
      config({ envRefs, args: [fixturePath, 'error-after-init'] }),
    );
    try {
      await expect(callTool(failing.client, 'mutate_remote_state', {})).rejects.toThrow(
        'fixture failure [redacted]',
      );
    } finally {
      await failing.close();
    }
  });

  it('suppresses raw child stderr in both production runtime paths', async () => {
    // Use built entry points in a host subprocess so inherited fd 2 is captured too.
    const script = `
      import { enumerateServer } from './packages/collector/dist/mcp-client.js';
      import { connectServer } from './packages/tester/dist/mcp-runtime.js';
      const config = JSON.parse(process.argv[1]);
      await enumerateServer(config);
      const connection = await connectServer(config);
      await connection.close();
    `;
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        script,
        JSON.stringify(config({ env: { SERVER_TOKEN: 'synthetic-stderr-credential' } })),
      ],
      {
        cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          USERPROFILE: process.env.USERPROFILE,
          SYSTEMROOT: process.env.SYSTEMROOT,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
    expect(exitCode, output).toBe(0);
    expect(output).not.toContain('synthetic-stderr-credential');
    expect(output).not.toContain('fixture stderr');
  });
});

describe('stdio reference persistence and replay', () => {
  it('persists only references and re-resolves credentials for the intended server during testing', async () => {
    vi.stubEnv('GITHUB_PERSONAL_ACCESS_TOKEN', 'synthetic-ambient-pat');
    vi.stubEnv('ASSESSMENT_ONE', 'synthetic-one-credential');
    vi.stubEnv('ASSESSMENT_TWO', 'synthetic-two-credential');
    const path = await configFile({
      one: config({ args: [fixturePath, 'reflect'], envRefs: { SERVER_TOKEN: 'ASSESSMENT_ONE' } }),
      two: config({ envRefs: { SERVER_TWO_TOKEN: 'ASSESSMENT_TWO' } }),
    });
    const collectionId = await collect({ configPath: path, dbPath: ':memory:' });
    const stored = createServersRepo(getDb()).findByCollection(collectionId);
    expect(stored.map((server) => JSON.parse(server.env_refs ?? '{}'))).toEqual([
      { SERVER_TOKEN: 'ASSESSMENT_ONE' },
      { SERVER_TWO_TOKEN: 'ASSESSMENT_TWO' },
    ]);
    const tools = createToolsRepo(getDb());
    for (const tool of tools.findByCollection(collectionId)) {
      tools.upsert({ ...tool, capabilities: JSON.stringify([Capability.MUTATE_REMOTE_STATE]) });
    }
    const summary = await runTests({ collectionId });
    expect(summary.totalPlanned).toBeGreaterThan(0);
    expect(summary.skipped).toBe(0);
    const persisted = [
      'servers',
      'tools',
      'resources',
      'prompts',
      'test_runs',
      'evidence',
      'logs',
    ].map((table) => getDb().prepare(`SELECT * FROM ${table}`).all());
    const observable = JSON.stringify({ persisted, summary }) + (await readFile(path, 'utf8'));
    for (const secret of [
      'synthetic-ambient-pat',
      'synthetic-one-credential',
      'synthetic-two-credential',
    ]) {
      expect(observable).not.toContain(secret);
    }
    expect(observable).toContain('[redacted]');
    const evidence = JSON.stringify(summary.testRuns);
    expect(evidence).toContain('\\"tokenOne\\":true');
    expect(evidence).toContain('\\"tokenTwo\\":true');
    expect(evidence).not.toContain('\\"ambientPat\\":true');
    vi.stubEnv('ASSESSMENT_ONE', 'synthetic-rotated-credential');
    const rotated = await runTests({ collectionId });
    expect(JSON.stringify(rotated.testRuns)).toContain('\\"tokenRotated\\":true');
    expect(JSON.stringify(rotated)).not.toContain('synthetic-rotated-credential');
    vi.stubEnv('ASSESSMENT_ONE', '');
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const later = await runTests({ collectionId });
    expect(later.skipped).toBeGreaterThan(0);
    expect(later.totalPlanned - later.skipped).toBeGreaterThan(0);
    expect(JSON.stringify(warnings.mock.calls)).toContain('Missing or empty stdio envRefs');
    expect(JSON.stringify(warnings.mock.calls)).not.toContain('synthetic-one-credential');
  });

  it('does not silently replay redacted legacy env using ambient values', async () => {
    const path = await configFile({
      legacy: config({ env: { STDIO_SETTING: 'literal-override' } }),
    });
    const collectionId = await collect({ configPath: path, dbPath: ':memory:' });
    const tools = createToolsRepo(getDb());
    for (const tool of tools.findByCollection(collectionId)) {
      tools.upsert({ ...tool, capabilities: JSON.stringify([Capability.MUTATE_REMOTE_STATE]) });
    }
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const summary = await runTests({ collectionId });
    expect(summary.totalPlanned).toBeGreaterThan(0);
    expect(summary.skipped).toBe(summary.totalPlanned);
    expect(JSON.stringify(warnings.mock.calls)).toContain('configure envRefs and recollect');
  });

  it('validates reference names during discovery without printing invalid values', async () => {
    const path = await configFile({
      invalid: config({ envRefs: { SERVER_TOKEN: 'invalid\nsynthetic-private-value' } }),
    });
    const error: unknown = await discoverConfigs({ configPath: path }).catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain('envRefs');
    expect(String(error)).not.toContain('synthetic-private-value');
  });

  it('keeps reflected startup failures out of collector logs and diagnostics', async () => {
    vi.stubEnv('ASSESSMENT_ONE', 'synthetic-one-credential');
    const path = await configFile({
      failing: config({
        args: [fixturePath, 'initialize-error'],
        envRefs: { SERVER_TOKEN: 'ASSESSMENT_ONE' },
      }),
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await collect({ configPath: path, dbPath: ':memory:' });
    const logs = JSON.stringify(getDb().prepare('SELECT * FROM logs').all());
    const diagnostics = errors.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
    expect(logs + diagnostics).toContain('[redacted]');
    expect(logs + diagnostics).not.toContain('synthetic-one-credential');
  });

  it('fails corrupted stored references with value-free tester diagnostics', async () => {
    const path = await configFile({ server: config() });
    const collectionId = await collect({ configPath: path, dbPath: ':memory:' });
    const tools = createToolsRepo(getDb());
    for (const tool of tools.findByCollection(collectionId)) {
      tools.upsert({ ...tool, capabilities: JSON.stringify([Capability.MUTATE_REMOTE_STATE]) });
    }
    getDb().prepare('UPDATE servers SET env_refs = ?').run('invalid synthetic-private-value');
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const summary = await runTests({ collectionId });
    expect(summary.skipped).toBe(summary.totalPlanned);
    expect(summary.totalPlanned).toBeGreaterThan(0);
    const diagnostics = JSON.stringify(warnings.mock.calls);
    expect(diagnostics).toContain('Invalid stored stdio environment configuration');
    expect(diagnostics).not.toContain('synthetic-private-value');
  });
});
