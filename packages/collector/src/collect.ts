import {
  createCollectionsRepo,
  createServersRepo,
  createToolsRepo,
  createResourcesRepo,
  createPromptsRepo,
  getDb,
} from '@iseemp/storage';
import { classifyTool, isKnownVerifiedServer } from '@iseemp/rules';
import { discoverConfigs } from './config-discovery.js';
import { enumerateServer } from './mcp-client.js';

export async function collect(options: {
  configPath?: string;
  serverUrl?: string;
  dbPath?: string;
}): Promise<string> {
  const db = getDb(options.dbPath ?? 'iseemp.db');
  const collections = createCollectionsRepo(db);
  const servers = createServersRepo(db);
  const tools = createToolsRepo(db);
  const resources = createResourcesRepo(db);
  const prompts = createPromptsRepo(db);

  const collectionId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  collections.create(collectionId, startedAt);

  const configs = await discoverConfigs({
    configPath: options.configPath,
    serverUrl: options.serverUrl,
  });

  if (configs.length === 0) {
    collections.fail(collectionId, 'No MCP server configurations found');
    throw new Error('No MCP server configurations found. Create iseemp.config.json or use --server <url>');
  }

  let totalTools = 0;
  let totalResources = 0;
  let totalPrompts = 0;

  for (const config of configs) {
    const serverId = `${collectionId}:${config.id}`;
    const now = new Date().toISOString();

    servers.upsert({
      id: serverId,
      collection_id: collectionId,
      name: config.name,
      url: config.url ?? null,
      command: config.command ?? null,
      args: config.args ? JSON.stringify(config.args) : null,
      env: config.env ? JSON.stringify(Object.fromEntries(Object.entries(config.env).map(([k]) => [k, '[redacted]']))) : null,
      transport: config.transport,
      is_verified: isKnownVerifiedServer({
        name: config.name,
        url: config.url ?? null,
        command: config.command ?? null,
        args: config.args ? JSON.stringify(config.args) : null,
      })
        ? 1
        : 0,
      created_at: now,
    });

    let enumResult: Awaited<ReturnType<typeof enumerateServer>>;
    try {
      enumResult = await enumerateServer(config);
    } catch (err) {
      console.error(`Failed to enumerate ${config.name}:`, err);
      continue;
    }

    for (const tool of enumResult.tools) {
      const toolId = `${serverId}:tool:${tool.name}`;
      const classification = classifyTool(tool);
      tools.upsert({
        id: toolId,
        collection_id: collectionId,
        server_id: serverId,
        name: tool.name,
        description: tool.description ?? null,
        input_schema: tool.inputSchema ? JSON.stringify(tool.inputSchema) : null,
        capabilities: JSON.stringify(classification.capabilities),
        risk_score: classification.riskScore,
        created_at: now,
      });
      totalTools++;
    }

    for (const resource of enumResult.resources) {
      const resourceId = `${serverId}:resource:${resource.uri}`;
      resources.upsert({
        id: resourceId,
        collection_id: collectionId,
        server_id: serverId,
        uri: resource.uri,
        name: resource.name ?? null,
        description: resource.description ?? null,
        mime_type: resource.mimeType ?? null,
        created_at: now,
      });
      totalResources++;
    }

    for (const prompt of enumResult.prompts) {
      const promptId = `${serverId}:prompt:${prompt.name}`;
      prompts.upsert({
        id: promptId,
        collection_id: collectionId,
        server_id: serverId,
        name: prompt.name,
        description: prompt.description ?? null,
        arguments: prompt.arguments ? JSON.stringify(prompt.arguments) : null,
        created_at: now,
      });
      totalPrompts++;
    }
  }

  collections.complete(collectionId, {
    serverCount: configs.length,
    toolCount: totalTools,
    resourceCount: totalResources,
    promptCount: totalPrompts,
  });

  return collectionId;
}
