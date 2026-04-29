import { describe, it, expect } from 'vitest';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverConfigs } from '@mcphound/collector';
import { classifyTool } from '@mcphound/rules';
import { Capability } from '@mcphound/core';

describe('CLI smoke tests', () => {
  it('discovers config from temp file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcphound-cli-'));
    const configPath = join(dir, 'mcphound.config.json');
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          'safe-mcp': {
            command: 'node',
            args: ['dist/index.js'],
          },
        },
      }),
    );

    const configs = await discoverConfigs({ configPath });
    await rm(dir, { recursive: true });

    expect(configs).toHaveLength(1);
    expect(configs[0]?.name).toBe('safe-mcp');
  });

  it('classifies safe-mcp tools correctly', () => {
    const safeMcpTools = [
      { name: 'read_file', description: 'Read a local file by path' },
      { name: 'write_file', description: 'Write content to a local file' },
      { name: 'run_shell', description: 'Execute a shell command on the host system' },
      { name: 'query_database', description: 'Run a SQL query against a database' },
      { name: 'send_http_request', description: 'Make an HTTP request to a URL' },
    ];

    const results = safeMcpTools.map((t) => ({ name: t.name, ...classifyTool(t) }));

    expect(results.find((r) => r.name === 'run_shell')?.capabilities).toContain(Capability.RUN_SHELL);
    expect(results.find((r) => r.name === 'read_file')?.capabilities).toContain(Capability.READ_LOCAL_FILE);
    expect(results.find((r) => r.name === 'write_file')?.capabilities).toContain(Capability.WRITE_LOCAL_FILE);
    expect(results.find((r) => r.name === 'query_database')?.capabilities).toContain(Capability.QUERY_DATABASE);
    expect(results.find((r) => r.name === 'send_http_request')?.capabilities).toContain(Capability.SEND_HTTP);

    // run_shell should be highest risk
    const shellRisk = results.find((r) => r.name === 'run_shell')?.riskScore ?? 0;
    expect(shellRisk).toBeGreaterThanOrEqual(90);
  });
});
