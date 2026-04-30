#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { collect } from '@iseemp/collector';
import { analyze } from '@iseemp/graph';
import { runTests } from '@iseemp/tester';
import { buildServer } from '@iseemp/api';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: 'string', short: 'c' },
    server: { type: 'string', short: 's' },
    db: { type: 'string', short: 'd', default: 'iseemp.db' },
    port: { type: 'string', short: 'p', default: '7474' },
    collection: { type: 'string' },
    profile: { type: 'string', default: 'safe' },
    help: { type: 'boolean', short: 'h' },
  },
});

const command = positionals[0];

if (args.help || !command) {
  console.log(`
ISeeMP — I See Model Paths — execution path analysis engine for AI systems

Usage:
  iseemp collect [options]              Enumerate MCP servers and persist inventory
  iseemp analyze [options]              Build graph and run findings rules
  iseemp test [options]                 Run deterministic path tests against a collection
  iseemp serve [options]                Start the web UI + API server

Options:
  -c, --config <path>       Path to iseemp.config.json (or Claude Desktop / VS Code config)
  -s, --server <url>        Enumerate a single MCP server by URL
  -d, --db <path>           SQLite database path (default: iseemp.db)
  -p, --port <n>            API server port (default: 7474)
  --collection <id>         Collection ID to analyze/test (default: latest)
  --profile <name>          Test profile to run (default: safe)
  -h, --help                Show this help message

Examples:
  iseemp collect
  iseemp collect --config iseemp.config.json
  iseemp collect --server http://localhost:3000/sse
  iseemp analyze
  iseemp test --profile safe
  iseemp serve --port 7474
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
    console.log('Run `iseemp analyze` to build the attack graph and find risks.');
    process.exit(0);
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
      console.log('\n⚠️  Critical findings detected! Run `iseemp serve` to investigate.');
    }
    process.exit(0);
  } catch (err) {
    console.error('❌ Analysis failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
} else if (command === 'test') {
  const profile = args.profile as string;
  if (profile !== 'safe') {
    console.error(`Unknown test profile: ${profile}. Supported: safe`);
    process.exit(1);
  }
  try {
    console.log(`🧪 Running deterministic test profile: ${profile}…`);
    const summary = await runTests({
      collectionId: args.collection as string | undefined,
      profile: 'safe',
      dbPath,
    });
    if (summary.totalPlanned === 0) {
      console.log('ℹ️  No tools matched any test case in the safe profile.');
      console.log('   Add the canary-mcp fixture to your iseemp.config.json and re-run collect.');
    } else {
      console.log(`\n✅ Test run complete:`);
      console.log(`  planned     : ${summary.totalPlanned}`);
      console.log(`  confirmed   : ${summary.confirmed}`);
      console.log(`  rejected    : ${summary.rejected}`);
      console.log(`  inconclusive: ${summary.inconclusive}`);
      for (const r of summary.testRuns) {
        const obs = r.canaryObserved ? '🚨 canary observed' : '— canary not observed';
        console.log(`   - [${r.pathStatus}] ${r.testCaseName} (${r.id}) ${obs}`);
      }
      console.log('\nRun `iseemp serve` to inspect findings, badges, and evidence in the UI.');
    }
    process.exit(0);
  } catch (err) {
    console.error('❌ Tests failed:', err instanceof Error ? err.message : err);
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
    console.log(`\n🚀 ISeeMP is running at http://localhost:${port}`);
    console.log('   API:    http://localhost:' + port + '/health');
    if (existsSync(staticDir)) {
      console.log('   Web UI: http://localhost:' + port + '/');
    } else {
      console.log('   Web UI: not built — run `pnpm --filter @iseemp/web build` first');
    }
  } catch (err) {
    console.error('❌ Server failed to start:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
} else {
  console.error(`Unknown command: ${command}`);
  console.error('Run `iseemp --help` for usage.');
  process.exit(1);
}
