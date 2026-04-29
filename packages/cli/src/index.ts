#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { collect } from '@mcphound/collector';
import { analyze } from '@mcphound/graph';
import { buildServer } from '@mcphound/api';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: 'string', short: 'c' },
    server: { type: 'string', short: 's' },
    db: { type: 'string', short: 'd', default: 'mcphound.db' },
    port: { type: 'string', short: 'p', default: '7474' },
    collection: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

const command = positionals[0];

if (args.help || !command) {
  console.log(`
MCPHound — BloodHound-style attack-path analysis for MCP ecosystems

Usage:
  mcphound collect [options]    Enumerate MCP servers and persist inventory
  mcphound analyze [options]    Build graph and run findings rules
  mcphound serve [options]      Start the web UI + API server

Options:
  -c, --config <path>       Path to mcphound.config.json (or Claude Desktop / VS Code config)
  -s, --server <url>        Enumerate a single MCP server by URL
  -d, --db <path>           SQLite database path (default: mcphound.db)
  -p, --port <n>            API server port (default: 7474)
  --collection <id>         Collection ID to analyze (default: latest)
  -h, --help                Show this help message

Examples:
  mcphound collect
  mcphound collect --config mcphound.config.json
  mcphound collect --server http://localhost:3000/sse
  mcphound analyze
  mcphound serve --port 7474
`);
  process.exit(0);
}

const dbPath = args.db as string;

if (command === 'collect') {
  try {
    console.log('🔍 Discovering MCP servers…');
    const collectionId = await collect({
      configPath: args.config as string | undefined,
      serverUrl: args.server as string | undefined,
      dbPath,
    });
    console.log(`✅ Collection complete: ${collectionId}`);
    console.log('Run `mcphound analyze` to build the attack graph and find risks.');
  } catch (err) {
    console.error('❌ Collection failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
} else if (command === 'analyze') {
  try {
    console.log('🧠 Analyzing graph and running findings rules…');
    const findings = await analyze({
      collectionId: args.collection as string | undefined,
      dbPath,
    });
    console.log(`\n✅ Analysis complete. Found ${findings.length} issues:\n`);
    const counts: Record<string, number> = {};
    for (const f of findings) {
      counts[f.severity] = (counts[f.severity] ?? 0) + 1;
    }
    for (const [sev, count] of Object.entries(counts).sort()) {
      console.log(`  ${sev.padEnd(10)}: ${count}`);
    }
    if (findings.some((f) => f.severity === 'critical')) {
      console.log('\n⚠️  Critical findings detected! Run `mcphound serve` to investigate.');
    }
  } catch (err) {
    console.error('❌ Analysis failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
} else if (command === 'serve') {
  const port = parseInt(args.port as string, 10);
  // Static dir: apps/web/dist relative to this file
  const __dir = dirname(fileURLToPath(import.meta.url));
  const staticDir = join(__dir, '..', '..', 'apps', 'web', 'dist');

  const { existsSync } = await import('node:fs');
  const app = buildServer({
    dbPath,
    staticDir: existsSync(staticDir) ? staticDir : undefined,
  });

  try {
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`\n🚀 MCPHound is running at http://localhost:${port}`);
    console.log('   API:    http://localhost:' + port + '/health');
    if (existsSync(staticDir)) {
      console.log('   Web UI: http://localhost:' + port + '/');
    } else {
      console.log('   Web UI: not built — run `pnpm --filter @mcphound/web build` first');
    }
  } catch (err) {
    console.error('❌ Server failed to start:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
} else {
  console.error(`Unknown command: ${command}`);
  console.error('Run `mcphound --help` for usage.');
  process.exit(1);
}
