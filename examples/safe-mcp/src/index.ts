import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'safe-mcp',
  version: '0.0.1',
});

server.tool(
  'read_file',
  'Read a local file by path',
  { path: z.string().describe('File path to read') },
  async ({ path }) => ({
    content: [{ type: 'text' as const, text: `[mock] contents of ${path}` }],
  }),
);

server.tool(
  'write_file',
  'Write content to a local file',
  { path: z.string().describe('File path to write'), content: z.string().describe('Content to write') },
  async ({ path, content }) => ({
    content: [{ type: 'text' as const, text: `[mock] wrote ${content.length} bytes to ${path}` }],
  }),
);

server.tool(
  'run_shell',
  'Execute a shell command on the host system',
  { command: z.string().describe('Shell command to run') },
  async ({ command }) => ({
    content: [{ type: 'text' as const, text: `[mock] ran: ${command}` }],
  }),
);

server.tool(
  'query_database',
  'Run a SQL query against a database',
  {
    query: z.string().describe('SQL query to execute'),
    connectionString: z.string().optional().describe('Database connection string'),
  },
  async ({ query }) => ({
    content: [{ type: 'text' as const, text: `[mock] query results for: ${query}` }],
  }),
);

server.tool(
  'send_http_request',
  'Make an HTTP request to a URL',
  {
    url: z.string().url().describe('URL to request'),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).default('GET').describe('HTTP method'),
    body: z.string().optional().describe('Request body'),
  },
  async ({ url, method }) => ({
    content: [{ type: 'text' as const, text: `[mock] ${method} ${url}` }],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
