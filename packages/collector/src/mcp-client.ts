import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ServerConfig, McpTool, McpResource, McpPrompt } from '@iseemp/core';

export interface EnumerationResult {
  tools: McpTool[];
  resources: McpResource[];
  prompts: McpPrompt[];
  errors?: {
    tools?: string;
    resources?: string;
    prompts?: string;
  };
}

export async function enumerateServer(config: ServerConfig): Promise<EnumerationResult> {
  const client = new Client({ name: 'iseemp-collector', version: '0.0.1' }, { capabilities: {} });

  let transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport;

  if (config.transport === 'stdio') {
    if (!config.command)
      throw new Error(`Server ${config.name} has no command for stdio transport`);
    transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: config.env ? ({ ...process.env, ...config.env } as Record<string, string>) : undefined,
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

  const errors: EnumerationResult['errors'] = {};
  if (toolsResult.status === 'rejected') {
    errors.tools =
      toolsResult.reason instanceof Error ? toolsResult.reason.message : String(toolsResult.reason);
  }
  if (resourcesResult.status === 'rejected') {
    errors.resources =
      resourcesResult.reason instanceof Error
        ? resourcesResult.reason.message
        : String(resourcesResult.reason);
  }
  if (promptsResult.status === 'rejected') {
    errors.prompts =
      promptsResult.reason instanceof Error
        ? promptsResult.reason.message
        : String(promptsResult.reason);
  }

  return {
    tools,
    resources,
    prompts,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
  };
}

function buildRemoteRequestInit(config: ServerConfig): RequestInit | undefined {
  // Intentionally allow an explicit process env fallback so Docker/CI flows can keep
  // bearer tokens out of persisted config files while still authenticating remote MCP calls.
  const token =
    config.env?.['GITHUB_PERSONAL_ACCESS_TOKEN'] ?? process.env['GITHUB_PERSONAL_ACCESS_TOKEN'];
  const authorization = config.env?.['Authorization'];
  if (!token && !authorization) return undefined;
  return {
    headers: {
      Authorization: authorization ?? `Bearer ${token}`,
    },
  };
}
