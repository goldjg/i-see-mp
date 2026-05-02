import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface ConnectedServer {
  client: Client;
  close: () => Promise<void>;
}

export interface ServerConnectConfig {
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  command?: string | null;
  args?: string[];
  env?: Record<string, string> | undefined;
  url?: string | null;
}

/**
 * Connect to an MCP server using the same transports the collector uses, but
 * keep the client alive so the tester can issue tools/call requests.
 */
export async function connectServer(config: ServerConnectConfig): Promise<ConnectedServer> {
  const client = new Client({ name: 'iseemp-tester', version: '0.0.1' }, { capabilities: {} });

  let transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport;
  if (config.transport === 'stdio') {
    if (!config.command) {
      throw new Error(`Server ${config.name} has no command for stdio transport`);
    }
    transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: { ...process.env, ...(config.env ?? {}) } as Record<string, string>,
    });
  } else {
    if (!config.url) {
      throw new Error(`Server ${config.name} has no URL for HTTP/SSE transport`);
    }
    const requestInit = buildRemoteRequestInit(config.env);
    transport =
      config.transport === 'http'
        ? new StreamableHTTPClientTransport(new URL(config.url), { requestInit })
        : new SSEClientTransport(new URL(config.url), { requestInit });
  }

  await client.connect(transport);

  return {
    client,
    close: async () => {
      await client.close();
    },
  };
}

export interface ToolCallResult {
  raw: unknown;
  text: string;
  isError: boolean;
}

/** Call a tool by name and normalise the result into a comparable shape. */
export async function callTool(
  client: Client,
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  const res = await client.callTool({ name: toolName, arguments: args });
  const isError = (res as { isError?: boolean }).isError === true;
  const content = (res as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  const text = content
    .map((c) => (typeof c.text === 'string' ? c.text : JSON.stringify(c)))
    .join('\n');
  return { raw: res, text, isError };
}

function buildRemoteRequestInit(env: Record<string, string> | undefined): RequestInit | undefined {
  const token = env?.['GITHUB_PERSONAL_ACCESS_TOKEN'] ?? process.env['GITHUB_PERSONAL_ACCESS_TOKEN'];
  const authorization = env?.['Authorization'];
  if (!token && !authorization) return undefined;
  return {
    headers: {
      ...(authorization ? { Authorization: authorization } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
}
