#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { collect } from '@iseemp/collector';
import { analyze } from '@iseemp/graph';
import { runTests } from '@iseemp/tester';
import { buildServer } from '@iseemp/api';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: 'string', short: 'c' },
    server: { type: 'string', short: 's' },
    db: { type: 'string', short: 'd', default: process.env.ISEEMP_DB ?? 'iseemp.db' },
    port: { type: 'string', short: 'p', default: '7474' },
    collection: { type: 'string' },
    profile: { type: 'string' },
    'test-repo-owner': { type: 'string' },
    'test-repo-name': { type: 'string' },
    'test-branch-prefix': { type: 'string' },
    'test-issue-prefix': { type: 'string' },
    'test-canary-prefix': { type: 'string' },
    'allow-unsafe-test-repo': { type: 'boolean' },
    'keep-artifacts': { type: 'boolean' },
    'create-test-pr': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

const command = positionals[0];
const demoSubcommand = positionals[1];

if (args.help || !command) {
  console.log(`
ISeeMP — I See Model Paths — execution path analysis engine for AI systems

Usage:
  iseemp collect [options]              Enumerate MCP servers and persist inventory
  iseemp analyze [options]              Build graph and run findings rules
  iseemp test [options]                 Run deterministic path tests against a collection
  iseemp demo up                        Build demo MCP fixture + write local demo config
  iseemp demo collect [options]         Collect inventory from demo MCP fixture
  iseemp demo test [options]            Run demo-confirm deterministic tests
  iseemp serve [options]                Start the web UI + API server

Options:
  -c, --config <path>       Path to iseemp.config.json (or Claude Desktop / VS Code config)
  -s, --server <url>        Enumerate a single MCP server by URL
  -d, --db <path>           SQLite database path (default: iseemp.db)
  -p, --port <n>            API server port (default: 7474)
  --collection <id>         Collection ID to analyze/test (default: latest)
  --profile <name>          Test profile to run (default: safe; also: demo-confirm, github-safe-canary, prompt-injection-github, prompt-injection-fetch, prompt-injection-db)
  --test-repo-owner <name>  Disposable GitHub owner for github-safe-canary
  --test-repo-name <name>   Disposable GitHub repo for github-safe-canary
  --test-branch-prefix <p>  Branch prefix for github-safe-canary artifacts
  --test-issue-prefix <p>   Issue title prefix for github-safe-canary artifacts
  --test-canary-prefix <p>  Canary marker prefix for github-safe-canary artifacts
  --allow-unsafe-test-repo  Allow repo names outside disposable safety pattern
  --keep-artifacts          Keep controlled test artifacts (skip cleanup)
  --create-test-pr          Optionally create canary PR/branch where supported
  -h, --help                Show this help message

Examples:
  iseemp collect
  iseemp collect --config iseemp.config.json
  iseemp collect --server http://localhost:3000/sse
  iseemp analyze
  iseemp test --profile safe
  iseemp test --profile github-safe-canary --test-repo-owner octo-org --test-repo-name canary-sandbox --test-branch-prefix iseemp-canary- --test-issue-prefix ISEEMP-CANARY- --test-canary-prefix ISEEMP-CANARY
  iseemp demo up
  iseemp demo collect
  iseemp demo test
  iseemp serve --port 7474
`);
  process.exit(0);
}

const dbPath = args.db as string;
const DEMO_CONFIG_PATH = 'iseemp.demo.config.json';
const DEMO_SERVER_ENTRY = 'examples/demo-mcp-server/dist/index.js';

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
  const profile = (args.profile as string | undefined) ?? 'safe';
  if (
    profile !== 'safe' &&
    profile !== 'demo-confirm' &&
    profile !== 'github-safe-canary' &&
    profile !== 'prompt-injection-github' &&
    profile !== 'prompt-injection-fetch' &&
    profile !== 'prompt-injection-db'
  ) {
    console.error(`Unknown test profile: ${profile}. Supported: safe, demo-confirm, github-safe-canary, prompt-injection-github, prompt-injection-fetch, prompt-injection-db`);
    process.exit(1);
  }
  try {
    console.log(`🧪 Running deterministic test profile: ${profile}…`);
    const summary = await runTests({
      collectionId: args.collection as string | undefined,
      profile: profile as
        | 'safe'
        | 'demo-confirm'
        | 'github-safe-canary'
        | 'prompt-injection-github'
        | 'prompt-injection-fetch'
        | 'prompt-injection-db',
      profileExplicitlySelected: typeof args.profile === 'string',
      githubSafeCanary:
        profile === 'github-safe-canary' || profile === 'prompt-injection-github'
          ? {
              owner: args['test-repo-owner'] as string | undefined,
              repo: args['test-repo-name'] as string | undefined,
              branchPrefix: args['test-branch-prefix'] as string | undefined,
              issuePrefix: args['test-issue-prefix'] as string | undefined,
              canaryPrefix: args['test-canary-prefix'] as string | undefined,
              allowUnsafeTestRepo: args['allow-unsafe-test-repo'] === true,
              keepArtifacts: args['keep-artifacts'] === true,
              createPullRequest: args['create-test-pr'] === true,
            }
          : undefined,
      dbPath,
    });
    if (summary.totalPlanned === 0) {
      console.log(`ℹ️  No tools matched any test case in the ${profile} profile.`);
      if (profile === 'demo-confirm') {
        console.log('   Run `iseemp demo up` then `iseemp demo collect` and retry.');
       } else if (profile === 'github-safe-canary' || profile === 'prompt-injection-github') {
         console.log('   Ensure a GitHub MCP server is collected and required github-safe-canary flags are set.');
       } else {
         console.log('   Add the canary-mcp fixture to your iseemp.config.json and re-run collect.');
       }
    } else {
      console.log(`\n✅ Test run complete:`);
      console.log(`  planned     : ${summary.totalPlanned}`);
      console.log(`  confirmed   : ${summary.confirmed}`);
      console.log(`  rejected    : ${summary.rejected}`);
      console.log(`  inconclusive: ${summary.inconclusive}`);
      console.log(`  injection-confirmed      : ${summary.injectionConfirmed}`);
      console.log(`  trust-boundary-confirmed : ${summary.trustBoundaryConfirmed}`);
      console.log(`  behavioural-deviation    : ${summary.behaviouralDeviation}`);
      if (summary.skipped > 0) {
        console.log(`  skipped     : ${summary.skipped} (server unavailable or missing credentials)`);
      }
      console.log(
        `  lethal trifecta: CONFIRMED ${summary.lethalTrifectaConfirmed} | POSSIBLE ${summary.lethalTrifectaPossible} | NONE ${summary.lethalTrifectaNone}`,
      );
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
} else if (command === 'demo') {
  if (demoSubcommand === 'up') {
    try {
      const demoBuilt = await demoServerBuilt();
      if (!demoBuilt) {
        console.log('🧩 Building demo MCP fixture…');
        await runShellCommand('pnpm', ['--filter', 'demo-mcp-server', 'build']);
      } else {
        console.log('🧩 Demo MCP fixture already built; reusing existing dist artifact.');
      }
      const config = {
        mcpServers: {
          'demo-mcp-server': {
            command: 'node',
            args: [DEMO_SERVER_ENTRY],
          },
        },
      };
      await writeFile(DEMO_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
      console.log(`✅ Demo fixture ready. Wrote ${DEMO_CONFIG_PATH}`);
      console.log('Next: `iseemp demo collect`, `iseemp analyze`, `iseemp demo test`, `iseemp serve`.');
      process.exit(0);
    } catch (err) {
      console.error('❌ Demo setup failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  } else if (demoSubcommand === 'collect') {
    try {
      await assertDemoConfigExists();
      console.log('🔍 Collecting from bundled demo MCP fixture…');
      const collectionId = await collect({
        configPath: DEMO_CONFIG_PATH,
        dbPath,
      });
      console.log(`✅ Demo collection complete: ${collectionId}`);
      console.log('Run `iseemp analyze` then `iseemp demo test`.');
      process.exit(0);
    } catch (err) {
      console.error('❌ Demo collect failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  } else if (demoSubcommand === 'test') {
    try {
      console.log('🧪 Running deterministic test profile: demo-confirm…');
      const summary = await runTests({
        collectionId: args.collection as string | undefined,
        profile: 'demo-confirm',
        dbPath,
      });
      if (summary.totalPlanned === 0) {
        console.log('ℹ️  No tools matched demo-confirm profile.');
        console.log('   Run `iseemp demo up` then `iseemp demo collect`, then `iseemp analyze`.');
      } else {
        console.log(`\n✅ Demo test run complete:`);
        console.log(`  planned     : ${summary.totalPlanned}`);
        console.log(`  confirmed   : ${summary.confirmed}`);
        console.log(`  rejected    : ${summary.rejected}`);
        console.log(`  inconclusive: ${summary.inconclusive}`);
        console.log(`  injection-confirmed      : ${summary.injectionConfirmed}`);
        console.log(`  trust-boundary-confirmed : ${summary.trustBoundaryConfirmed}`);
        console.log(`  behavioural-deviation    : ${summary.behaviouralDeviation}`);
      }
      process.exit(0);
    } catch (err) {
      console.error('❌ Demo test failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  } else {
    console.error(`Unknown demo command: ${demoSubcommand ?? '(none)'}`);
    console.error('Supported demo commands: up, collect, test');
    process.exit(1);
  }
} else if (command === 'serve') {
  const port = parseInt(args.port as string, 10);
  // Static dir: apps/web/dist relative to this file
  const __dir = dirname(fileURLToPath(import.meta.url));
  const staticDir = join(__dir, '..', '..', '..', 'apps', 'web', 'dist');

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

async function assertDemoConfigExists(): Promise<void> {
  try {
    await access(DEMO_CONFIG_PATH, constants.F_OK);
  } catch {
    throw new Error(`Missing ${DEMO_CONFIG_PATH}. Run \`iseemp demo up\` first.`);
  }
}

/** Returns true when the demo MCP server entry artifact exists at DEMO_SERVER_ENTRY. */
async function demoServerBuilt(): Promise<boolean> {
  try {
    await access(DEMO_SERVER_ENTRY, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function runShellCommand(cmd: string, cmdArgs: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${cmdArgs.join(' ')} exited with code ${code ?? 'unknown'}`));
    });
  });
}
