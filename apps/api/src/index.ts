export { buildServer } from './server.js';

import { buildServer } from './server.js';

const port = parseInt(process.env['PORT'] ?? '7474', 10);
const dbPath = process.env['DB_PATH'] ?? 'iseemp.db';
const staticDir = process.env['STATIC_DIR'];

const app = buildServer({ dbPath, staticDir });

try {
  const address = await app.listen({ port, host: '0.0.0.0' });
  console.log(`ISeeMP API listening on ${address}`);
} catch (err) {
  console.error('Failed to start server:', err);
  process.exit(1);
}
