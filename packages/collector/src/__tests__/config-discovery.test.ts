import { describe, it, expect } from 'vitest';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverConfigs } from '../config-discovery.js';

describe('discoverConfigs', () => {
  it('loads servers from explicit config path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'iseemp-test-'));
    const configPath = join(dir, 'iseemp.config.json');
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          github: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_test' },
          },
          remote: {
            url: 'https://api.example.com/mcp',
            transport: 'http',
          },
        },
      }),
      'utf-8',
    );

    const configs = await discoverConfigs({ configPath });

    await rm(dir, { recursive: true });

    expect(configs).toHaveLength(2);
    const github = configs.find((c) => c.name === 'github');
    expect(github?.transport).toBe('stdio');
    expect(github?.command).toBe('npx');

    const remote = configs.find((c) => c.name === 'remote');
    expect(remote?.transport).toBe('http');
    expect(remote?.url).toBe('https://api.example.com/mcp');
  });

  it('returns a single server for --server URL', async () => {
    const configs = await discoverConfigs({ serverUrl: 'http://localhost:9999/sse' });
    expect(configs).toHaveLength(1);
    expect(configs[0]?.url).toBe('http://localhost:9999/sse');
    expect(configs[0]?.transport).toBe('sse');
  });

  it('returns empty array when config file is missing', async () => {
    const configs = await discoverConfigs({ configPath: '/nonexistent/path/config.json' });
    expect(configs).toHaveLength(0);
  });
});
