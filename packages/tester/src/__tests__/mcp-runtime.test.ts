import { describe, expect, it } from 'vitest';
import { callTool } from '../mcp-runtime.js';

describe('callTool', () => {
  it('includes structuredContent in normalized text output', async () => {
    const client = {
      callTool: async () => ({
        content: [{ type: 'text', text: 'issue created' }],
        structuredContent: {
          number: 123,
          body: 'ISEEMP-marker',
          html_url: 'https://github.com/goldjg/canary-sandbox/issues/123',
        },
        isError: false,
      }),
    };

    const res = await callTool(client as never, 'issue_write', {});

    expect(res.isError).toBe(false);
    expect(res.text).toContain('issue created');
    expect(res.text).toContain('"number":123');
    expect(res.text).toContain('ISEEMP-marker');
    expect(res.text).toContain('html_url');
  });
});
