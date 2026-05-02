import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ServerConfig, McpTool, McpResource, McpPrompt } from '@iseemp/core';

export interface EnumerationResult {
  tools: McpTool[];
  resources: McpResource[];
  prompts: McpPrompt[];
}

export async function enumerateServer(config: ServerConfig): Promise<EnumerationResult> {
  const client = new Client(
    { name: 'iseemp-collector', version: '0.0.1' },
    { capabilities: {} },
  );

  let transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport;

  if (config.transport === 'stdio') {
    if (!config.command) throw new Error(`Server ${config.name} has no command for stdio transport`);
    transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: config.env ? { ...process.env, ...config.env } as Record<string, string> : undefined,
    });
  } else {
    if (!config.url) throw new Error(`Server ${config.name} has no URL for SSE/HTTP transport`);
    const requestInit = buildRemoteRequestInit(config);
    transport =
      config.transport === 'http'
        ? new StreamableHTTPClientTransport(new URL(config.url), { requestInit })
        : new SSEClientTransport(new URL(config.url), { requestInit });
  }

  await client.connect(transport);

  const [toolsResult, resourcesResult, promptsResult] = await Promise.allSettled([
    client.listTools(),
    client.listResources(),
    client.listPrompts(),
  ]);

  await client.close();

  const tools: McpTool[] =
    toolsResult.status === 'fulfilled'
      ? toolsResult.value.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema as Record<string, unknown> | undefined,
        }))
      : [];

  const resources: McpResource[] =
    resourcesResult.status === 'fulfilled'
      ? resourcesResult.value.resources.map((r) => ({
          uri: r.uri,
          name: r.name,
          description: r.description,
          mimeType: r.mimeType,
        }))
      : [];

  const prompts: McpPrompt[] =
    promptsResult.status === 'fulfilled'
      ? promptsResult.value.prompts.map((p) => ({
          name: p.name,
          description: p.description,
          arguments: p.arguments,
        }))
      : [];

  return { tools, resources, prompts };
}

function buildRemoteRequestInit(config: ServerConfig): RequestInit | undefined {
  const token = config.env?.['GITHUB_PERSONAL_ACCESS_TOKEN'] ?? process.env['GITHUB_PERSONAL_ACCESS_TOKEN'];
  const authorization = config.env?.['Authorization'];
  if (!token && !authorization) return undefined;
  return {
    headers: {
      ...(authorization ? { Authorization: authorization } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
}
