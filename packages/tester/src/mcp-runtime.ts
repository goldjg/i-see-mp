import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { remoteRequestOptions, stdioEnvironment, type RemoteAuth } from '@iseemp/core';

const stdioRedactors = new WeakMap<Client, (value: unknown) => unknown>();

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
  envRefs?: Record<string, string>;
  auth?: RemoteAuth;
  url?: string | null;
}

/**
 * Connect to an MCP server using the same transports the collector uses, but
 * keep the client alive so the tester can issue tools/call requests.
 */
export async function connectServer(config: ServerConnectConfig): Promise<ConnectedServer> {
  const client = new Client({ name: 'iseemp-tester', version: '0.0.1' }, { capabilities: {} });

  let transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport;
  let redact: (value: unknown) => unknown = (value) => value;
  if (config.transport === 'stdio') {
    if (!config.command) {
      throw new Error(`Server ${config.name} has no command for stdio transport`);
    }
    const environment = stdioEnvironment(config);
    redact = environment.redact;
    stdioRedactors.set(client, redact);
    transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: environment.env,
      stderr: 'ignore',
    });
  } else {
    if (!config.url) {
      throw new Error(`Server ${config.name} has no URL for HTTP/SSE transport`);
    }
    const url = new URL(config.url);
    const options = remoteRequestOptions(url, config);
    transport =
      config.transport === 'http'
        ? new StreamableHTTPClientTransport(url, options)
        : new SSEClientTransport(url, options);
  }

  try {
    await client.connect(transport);
  } catch (error) {
    await client.close();
    if (config.transport === 'stdio') {
      throw new Error(String(redact(error instanceof Error ? error.message : String(error))));
    }
    throw error;
  }

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
  const redact = stdioRedactors.get(client);
  let res;
  try {
    const result = await client.callTool({ name: toolName, arguments: args });
    res = redact ? CallToolResultSchema.parse(redact(result)) : result;
  } catch (error) {
    if (redact) {
      throw new Error(String(redact(error instanceof Error ? error.message : String(error))));
    }
    throw error;
  }
  const isError = (res as { isError?: boolean }).isError === true;
  const text = extractToolResultText(res);
  return { raw: res, text, isError };
}

function extractToolResultText(res: unknown): string {
  if (!res || typeof res !== 'object') return '';
  const result = res as {
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: unknown;
  };
  const parts: string[] = [];
  for (const item of result.content ?? []) {
    if (typeof item?.text === 'string') {
      parts.push(item.text);
    } else {
      parts.push(JSON.stringify(item));
    }
  }
  if (typeof result.structuredContent !== 'undefined') {
    parts.push(JSON.stringify(result.structuredContent));
  }
  return parts.filter((part) => part.length > 0).join('\n');
}
