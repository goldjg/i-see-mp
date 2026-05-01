import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'demo-mcp-server',
  version: '0.0.1',
});

const SECRET_CANARY = 'CANARY-DEMO-SECRET-0001';

server.tool(
  'read_secret_canary',
  'Return deterministic demo secret canary value',
  { name: z.string().optional().describe('Logical secret name') },
  async ({ name }) => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          name: name ?? 'demo-secret',
          value: SECRET_CANARY,
        }),
      },
    ],
  }),
);

server.tool(
  'read_metadata',
  'Read low-sensitivity metadata for deterministic demo tests',
  {},
  async () => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          environment: 'demo',
          region: 'local-dev',
          service: 'iseemp-demo',
          note: 'low-sensitivity metadata',
        }),
      },
    ],
  }),
);

function isLocalhostUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (
      u.hostname === 'localhost' ||
      u.hostname === '127.0.0.1' ||
      u.hostname === '::1' ||
      u.hostname === '[::1]'
    );
  } catch {
    return false;
  }
}

server.tool(
  'send_to_mock_sink',
  'Send payload to webhook-style sink URL (localhost-only in demo fixture)',
  {
    url: z.string().url().describe('Destination URL'),
    payload: z.string().describe('Payload string to send'),
  },
  async ({ url, payload }) => {
    if (!isLocalhostUrl(url)) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: 'non-local url blocked', url }) }],
      };
    }
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ ok: response.ok, status: response.status, url }) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: message, url }) }],
      };
    }
  },
);

server.tool(
  'blocked_send',
  'Attempt webhook-style send but deterministically simulate policy block',
  {
    url: z.string().url().describe('Destination URL'),
    payload: z.string().describe('Payload string to send'),
  },
  async ({ url }) => ({
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          ok: false,
          blocked: true,
          reason: 'demo policy blocked outbound send',
          url,
        }),
      },
    ],
  }),
);

server.tool(
  'mutate_remote_state',
  'Dry-run mutation tool for deterministic demo tests (no real mutation)',
  {
    resource: z.string().describe('Resource identifier'),
    action: z.enum(['create', 'update', 'delete']).describe('Requested mutation'),
    payload: z.string().optional().describe('Optional payload'),
  },
  async ({ resource, action, payload }) => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          ok: true,
          dryRun: true,
          resource,
          action,
          payloadEcho: payload ?? null,
          marker: 'CANARY-DEMO-MUTATION-DRYRUN',
        }),
      },
    ],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
