import { createInterface } from 'node:readline';
import process from 'node:process';

const mode = process.argv[2];
const present = (name) => Object.hasOwn(process.env, name);
const report = () =>
  JSON.stringify({
    ambientPat: present('GITHUB_PERSONAL_ACCESS_TOKEN'),
    ambientCloud: present('AWS_SECRET_ACCESS_KEY'),
    parentSetting: present('STDIO_PARENT_SETTING'),
    sourceOne: present('ASSESSMENT_ONE'),
    sourceTwo: present('ASSESSMENT_TWO'),
    tokenOne: process.env.SERVER_TOKEN === 'synthetic-one-credential',
    tokenRotated: process.env.SERVER_TOKEN === 'synthetic-rotated-credential',
    tokenTwo: process.env.SERVER_TWO_TOKEN === 'synthetic-two-credential',
    explicitOverride: process.env.STDIO_SETTING === 'literal-override',
    referenceOverride: process.env.STDIO_SETTING === 'synthetic-one-credential',
    literalUnexpanded: process.env.STDIO_LITERAL === '${STDIO_PARENT_SETTING}',
    runtimePath: present('PATH'),
    runtimeHome: present(process.platform === 'win32' ? 'USERPROFILE' : 'HOME'),
    pathOverride: process.env.PATH === process.env.STDIO_EXPECTED_PATH,
    emptyOverride: process.env.STDIO_EMPTY === '',
    reflected: mode === 'reflect' ? process.env.SERVER_TOKEN : undefined,
  });

// Only synthetic credentials are supplied by these tests.
process.stderr.write(`fixture stderr ${process.env.SERVER_TOKEN ?? 'no-token'}\n`);
const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  if (
    (mode === 'error-after-init' && message.method !== 'initialize') ||
    (mode === 'initialize-error' && message.method === 'initialize')
  ) {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32603, message: `fixture failure ${process.env.SERVER_TOKEN}` },
      })}\n`,
    );
    return;
  }
  let result = {};
  switch (message.method) {
    case 'initialize':
      result = {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: 'environment-fixture', version: '1.0.0' },
      };
      break;
    case 'tools/list':
      result = {
        tools: [
          {
            name: 'mutate_remote_state',
            description: `Modify remote state. ${report()}`,
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      };
      break;
    case 'resources/list':
      result = {
        resources:
          mode === 'reflect'
            ? [
                {
                  uri: 'fixture://resource',
                  name: 'fixture',
                  description: process.env.SERVER_TOKEN,
                },
              ]
            : [],
      };
      break;
    case 'prompts/list':
      result = {
        prompts:
          mode === 'reflect' ? [{ name: 'fixture', description: process.env.SERVER_TOKEN }] : [],
      };
      break;
    case 'tools/call':
      result = { content: [{ type: 'text', text: report() }] };
      break;
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`);
});
