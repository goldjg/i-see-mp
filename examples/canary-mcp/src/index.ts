// canary-mcp — local demo MCP fixture used by `iseemp test --profile safe`.
//
// All tools are deterministic, side-effect-free fakes:
//   - read_secret              -> returns a known fake "secret" string
//   - read_team_metadata       -> returns fake org/team metadata
//   - send_webhook             -> POSTs to a *local* mock sink only (CANARY_SINK_URL),
//                                  never to a real external service
//   - mutate_remote_state      -> records (does not perform) a fake mutation
//
// The fixture intentionally never calls real external services. The send_webhook
// tool refuses any URL that is not localhost / 127.0.0.1 / ::1.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'canary-mcp',
  version: '0.0.1',
});

// Deterministic fake "secret" payload. The tester injects this into the
// downstream send_webhook call to detect path completion via canary observation.
const FAKE_SECRET_VALUE = 'CANARY-SECRET-9b2f6e1a-not-a-real-credential';
const FAKE_TEAM_METADATA = {
  org: 'acme-canary',
  team: 'platform-canary',
  members: ['alice@example.invalid', 'bob@example.invalid'],
  marker: 'CANARY-METADATA-7d4c1a90-not-real-data',
};

server.tool(
  'read_secret',
  'Return a stored secret/API token by name (fake; sensitive read for canary tests)',
  { name: z.string().describe('Name of the secret to read') },
  async ({ name }) => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ name, value: FAKE_SECRET_VALUE }),
      },
    ],
  }),
);

server.tool(
  'list_team_members',
  'List members of an organisation team (fake; medium-sensitivity read)',
  { team: z.string().describe('Team identifier') },
  async ({ team }) => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ ...FAKE_TEAM_METADATA, team }),
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
      u.hostname === '[::1]' ||
      u.hostname === '::1'
    );
  } catch {
    return false;
  }
}

server.tool(
  'send_webhook',
  'Send a JSON payload to an external webhook URL (fake; localhost-only sink)',
  {
    url: z.string().url().describe('Webhook destination URL'),
    payload: z.string().describe('Payload to send (JSON-encoded string)'),
  },
  async ({ url, payload }) => {
    if (!isLocalhostUrl(url)) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              ok: false,
              error: 'canary-mcp refuses non-localhost URLs',
              url,
            }),
          },
        ],
        isError: true,
      };
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ ok: res.ok, status: res.status, url }),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ ok: false, error: message, url }) },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'update_issue',
  'Update an issue on a remote tracker (fake; no real call performed)',
  {
    resource: z.string().describe('Issue / resource identifier'),
    action: z.enum(['create', 'update', 'delete']).describe('Mutation kind'),
    payload: z.string().optional().describe('Payload as JSON string'),
  },
  async ({ resource, action, payload }) => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          ok: true,
          mutated: true,
          resource,
          action,
          payloadEcho: payload ?? null,
          marker: 'CANARY-MUTATION-applied',
        }),
      },
    ],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
