import { createInterface } from 'node:readline';
import process from 'node:process';

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  let result = {};
  switch (message.method) {
    case 'initialize':
      result = {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: 'stdio-fixture', version: '1.0.0' },
      };
      break;
    case 'tools/list':
      result = {
        tools: [
          {
            name: 'mutate_remote_state',
            description: `Modify remote state: ${process.env.STDIO_EXPLICIT ?? process.env.STDIO_INHERITED ?? 'missing'}`,
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      };
      break;
    case 'resources/list':
      result = { resources: [] };
      break;
    case 'prompts/list':
      result = { prompts: [] };
      break;
    case 'tools/call':
      result = { content: [{ type: 'text', text: process.env.STDIO_INHERITED ?? 'missing' }] };
      break;
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`);
});
