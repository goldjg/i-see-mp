import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ServerConfigSchema } from '@iseemp/core';
import type { ServerConfig } from '@iseemp/core';

interface ClaudeDesktopConfig {
  mcpServers?: Record<
    string,
    {
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      url?: string;
      transport?: 'stdio' | 'http' | 'sse';
    }
  >;
}

async function readJson(path: string): Promise<unknown> {
  const text = await readFile(path, 'utf-8');
  return JSON.parse(text) as unknown;
}

function normaliseTransport(entry: {
  command?: string;
  url?: string;
  transport?: 'stdio' | 'http' | 'sse';
}): 'stdio' | 'http' | 'sse' {
  if (entry.transport) return entry.transport;
  if (entry.url) return 'sse';
  return 'stdio';
}

async function loadClaudeDesktopConfig(): Promise<ServerConfig[]> {
  const paths: string[] = [];

  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'];
    if (appData) paths.push(join(appData, 'Claude', 'claude_desktop_config.json'));
  } else if (process.platform === 'darwin') {
    paths.push(
      join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    );
  } else {
    paths.push(join(homedir(), '.config', 'Claude', 'claude_desktop_config.json'));
  }

  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      const raw = (await readJson(p)) as ClaudeDesktopConfig;
      if (!raw.mcpServers) continue;
      return Object.entries(raw.mcpServers).map(([name, entry]) =>
        ServerConfigSchema.parse({
          id: `claude:${name}`,
          name,
          url: entry.url,
          command: entry.command,
          args: entry.args,
          env: entry.env,
          transport: normaliseTransport(entry),
        }),
      );
    } catch {
      // ignore parse errors
    }
  }
  return [];
}

async function loadVSCodeConfig(): Promise<ServerConfig[]> {
  const settingsPath = join(homedir(), '.vscode', 'settings.json');
  if (!existsSync(settingsPath)) return [];
  try {
    const raw = (await readJson(settingsPath)) as Record<string, unknown>;
    const servers = raw['mcpServers'] as
      | Record<
          string,
          {
            command?: string;
            args?: string[];
            env?: Record<string, string>;
            url?: string;
            transport?: 'stdio' | 'http' | 'sse';
          }
        >
      | undefined;
    if (!servers) return [];
    return Object.entries(servers).map(([name, entry]) =>
      ServerConfigSchema.parse({
        id: `vscode:${name}`,
        name,
        url: entry.url,
        command: entry.command,
        args: entry.args,
        env: entry.env,
        transport: normaliseTransport(entry),
      }),
    );
  } catch {
    return [];
  }
}

async function loadLocalConfig(configPath: string): Promise<ServerConfig[]> {
  if (!existsSync(configPath)) return [];
  try {
    const raw = (await readJson(configPath)) as ClaudeDesktopConfig;
    if (!raw.mcpServers) return [];
    return Object.entries(raw.mcpServers).map(([name, entry]) =>
      ServerConfigSchema.parse({
        id: `local:${name}`,
        name,
        url: entry.url,
        command: entry.command,
        args: entry.args,
        env: entry.env,
        transport: normaliseTransport(entry),
      }),
    );
  } catch {
    return [];
  }
}

export async function discoverConfigs(options: {
  configPath?: string;
  serverUrl?: string;
}): Promise<ServerConfig[]> {
  if (options.serverUrl) {
    return [
      ServerConfigSchema.parse({
        id: `url:${options.serverUrl}`,
        name: options.serverUrl,
        url: options.serverUrl,
        transport: 'sse',
      }),
    ];
  }

  const results: ServerConfig[] = [];

  // 1. Explicit config path
  if (options.configPath) {
    results.push(...(await loadLocalConfig(options.configPath)));
    return results;
  }

  // 2. iseemp.config.json in CWD
  const local = join(process.cwd(), 'iseemp.config.json');
  results.push(...(await loadLocalConfig(local)));

  // 3. Claude Desktop
  results.push(...(await loadClaudeDesktopConfig()));

  // 4. VS Code
  results.push(...(await loadVSCodeConfig()));

  // Deduplicate by id
  const seen = new Set<string>();
  return results.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
}
