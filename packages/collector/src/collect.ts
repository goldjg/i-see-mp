import {
  createCollectionsRepo,
  createServersRepo,
  createToolsRepo,
  createResourcesRepo,
  createPromptsRepo,
  getDb,
  log,
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
  log(db, {
    level: 'info',
    phase: 'collect',
    eventType: 'collect.start',
    message: 'Collect started',
    collectionId,
  });

  const configs = await discoverConfigs({
    configPath: options.configPath,
    serverUrl: options.serverUrl,
  });

  if (configs.length === 0) {
    collections.fail(collectionId, 'No MCP server configurations found');
    log(db, {
      level: 'error',
      phase: 'collect',
      eventType: 'collect.config.missing',
      message: 'No MCP server configurations found',
      collectionId,
    });
    throw new Error(
      'No MCP server configurations found. Create iseemp.config.json or use --server <url>',
    );
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
      env: config.env
        ? JSON.stringify(
            Object.fromEntries(Object.entries(config.env).map(([k]) => [k, '[redacted]'])),
          )
        : null,
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
      log(db, {
        level: 'info',
        phase: 'collect',
        eventType: 'collect.server.connect.success',
        message: `Enumerated server ${config.name}`,
        collectionId,
        serverId,
        details: {
          toolCount: enumResult.tools.length,
          resourceCount: enumResult.resources.length,
          promptCount: enumResult.prompts.length,
        },
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log(db, {
        level: 'error',
        phase: 'collect',
        eventType: 'collect.server.connect.failure',
        message: errorMessage,
        collectionId,
        serverId,
        details: { serverName: config.name },
      });
      console.error(`Failed to enumerate ${config.name}:`, err);
      continue;
    }

    if (enumResult.errors?.tools) {
      log(db, {
        level: 'error',
        phase: 'collect',
        eventType: 'collect.enumeration.tools.error',
        message: enumResult.errors.tools,
        collectionId,
        serverId,
      });
    }
    if (enumResult.errors?.resources) {
      log(db, {
        level: 'error',
        phase: 'collect',
        eventType: 'collect.enumeration.resources.error',
        message: enumResult.errors.resources,
        collectionId,
        serverId,
      });
    }
    if (enumResult.errors?.prompts) {
      log(db, {
        level: 'error',
        phase: 'collect',
        eventType: 'collect.enumeration.prompts.error',
        message: enumResult.errors.prompts,
        collectionId,
        serverId,
      });
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
        source_role: JSON.stringify(classification.sourceRole),
        is_untrusted: classification.isUntrusted ? 1 : 0,
        is_instruction_capable: classification.isInstructionCapable ? 1 : 0,
        content_origin: classification.contentOrigin,
        trust_zone: null,
        risk_score: classification.riskScore,
        classification_evidence: JSON.stringify(classification.evidence),
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
  log(db, {
    level: 'info',
    phase: 'collect',
    eventType: 'collect.end',
    message: 'Collect completed',
    collectionId,
    details: {
      serverCount: configs.length,
      toolCount: totalTools,
      resourceCount: totalResources,
      promptCount: totalPrompts,
    },
  });

  return collectionId;
}
