import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  ListToolsResultSchema,
  ListResourcesResultSchema,
  ListPromptsResultSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ServerConfig, McpTool, McpResource, McpPrompt } from '@iseemp/core';
import { remoteRequestOptions, stdioEnvironment } from '@iseemp/core';

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
  let redact: (value: unknown) => unknown = (value) => value;

  if (config.transport === 'stdio') {
    if (!config.command)
      throw new Error(`Server ${config.name} has no command for stdio transport`);
    const environment = stdioEnvironment(config);
    redact = environment.redact;
    transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: environment.env,
      stderr: 'ignore',
    });
  } else {
    if (!config.url) throw new Error(`Server ${config.name} has no URL for SSE/HTTP transport`);
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

  const [toolsResult, resourcesResult, promptsResult] = await Promise.allSettled([
    client
      .listTools()
      .then((value) =>
        config.transport === 'stdio' ? ListToolsResultSchema.parse(redact(value)) : value,
      ),
    client
      .listResources()
      .then((value) =>
        config.transport === 'stdio' ? ListResourcesResultSchema.parse(redact(value)) : value,
      ),
    client
      .listPrompts()
      .then((value) =>
        config.transport === 'stdio' ? ListPromptsResultSchema.parse(redact(value)) : value,
      ),
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
    errors.tools = String(
      redact(
        toolsResult.reason instanceof Error
          ? toolsResult.reason.message
          : String(toolsResult.reason),
      ),
    );
  }
  if (resourcesResult.status === 'rejected') {
    errors.resources = String(
      redact(
        resourcesResult.reason instanceof Error
          ? resourcesResult.reason.message
          : String(resourcesResult.reason),
      ),
    );
  }
  if (promptsResult.status === 'rejected') {
    errors.prompts = String(
      redact(
        promptsResult.reason instanceof Error
          ? promptsResult.reason.message
          : String(promptsResult.reason),
      ),
    );
  }

  return {
    tools,
    resources,
    prompts,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
  };
}
