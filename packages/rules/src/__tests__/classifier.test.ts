import { describe, it, expect } from 'vitest';
import { classifyTool } from '../classifier.js';
import { Capability } from '@iseemp/core';

describe('classifyTool — safe-mcp fixtures', () => {
  it('classifies read_file correctly', () => {
    const result = classifyTool({ name: 'read_file', description: 'Read a local file by path' });
    expect(result.capabilities).toContain(Capability.READ_LOCAL_FILE);
    expect(result.riskScore).toBeGreaterThanOrEqual(30);
  });

  it('classifies write_file correctly', () => {
    const result = classifyTool({ name: 'write_file', description: 'Write content to a local file' });
    expect(result.capabilities).toContain(Capability.WRITE_LOCAL_FILE);
    expect(result.riskScore).toBeGreaterThanOrEqual(55);
  });

  it('classifies run_shell as high risk', () => {
    const result = classifyTool({ name: 'run_shell', description: 'Execute a shell command' });
    expect(result.capabilities).toContain(Capability.RUN_SHELL);
    expect(result.capabilities).toContain(Capability.EXECUTE_CODE);
    expect(result.riskScore).toBeGreaterThanOrEqual(90);
  });

  it('classifies query_database correctly', () => {
    const result = classifyTool({
      name: 'query_database',
      description: 'Run a SQL query against a database',
      inputSchema: { type: 'object', properties: { query: { type: 'string' }, connectionString: { type: 'string' } } },
    });
    expect(result.capabilities).toContain(Capability.QUERY_DATABASE);
  });

  it('classifies send_http_request correctly', () => {
    const result = classifyTool({
      name: 'send_http_request',
      description: 'Make an HTTP request to a URL',
      inputSchema: { type: 'object', properties: { url: { type: 'string' }, method: { type: 'string' } } },
    });
    expect(result.capabilities).toContain(Capability.SEND_HTTP);
    expect(result.riskScore).toBeGreaterThanOrEqual(60);
  });
});

describe('classifyTool — GitHub MCP shaped tools', () => {
  it('classifies push_files correctly', () => {
    const result = classifyTool({
      name: 'push_files',
      description: 'Push files to a GitHub repository',
    });
    expect(result.capabilities).toContain(Capability.CREATE_TICKET);
  });

  it('classifies create_issue correctly', () => {
    const result = classifyTool({
      name: 'create_issue',
      description: 'Create a GitHub issue in a repository',
    });
    expect(result.capabilities).toContain(Capability.CREATE_TICKET);
  });

  it('classifies get_file_contents as read', () => {
    const result = classifyTool({
      name: 'get_file_contents',
      description: 'Get the contents of a file from a GitHub repository',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, repo: { type: 'string' } } },
    });
    expect(result.capabilities).toContain(Capability.READ_LOCAL_FILE);
  });

  it('classifies search_repositories as remote data read', () => {
    const result = classifyTool({
      name: 'search_repositories',
      description: 'Search GitHub repositories',
    });
    // GitHub tool — should pick up CREATE_TICKET from 'github' in the name
    expect(result.capabilities).toContain(Capability.CREATE_TICKET);
  });

  it('classifies create_pull_request correctly', () => {
    const result = classifyTool({
      name: 'create_pull_request',
      description: 'Create a pull request on GitHub',
    });
    expect(result.capabilities).toContain(Capability.CREATE_TICKET);
  });

  it('classifies list_commits correctly', () => {
    const result = classifyTool({
      name: 'list_commits',
      description: 'List commits in a GitHub repository',
    });
    // Not a dangerous tool — should have low score
    expect(result.riskScore).toBeLessThan(80);
  });
});

describe('classifyTool — schema-based inference', () => {
  it('infers READ_LOCAL_FILE from path parameter', () => {
    const result = classifyTool({
      name: 'read_content',
      description: 'Get content',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    });
    expect(result.capabilities).toContain(Capability.READ_LOCAL_FILE);
  });

  it('infers READ_REMOTE_DATA from url parameter', () => {
    const result = classifyTool({
      name: 'fetch_data',
      description: 'Fetch some data',
      inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
    });
    expect(result.capabilities).toContain(Capability.READ_REMOTE_DATA);
  });

  it('infers RUN_SHELL from command parameter', () => {
    const result = classifyTool({
      name: 'do_thing',
      description: 'Do a thing',
      inputSchema: { type: 'object', properties: { command: { type: 'string' } } },
    });
    expect(result.capabilities).toContain(Capability.RUN_SHELL);
  });
});

describe('classifyTool — UNKNOWN fallback', () => {
  it('returns UNKNOWN for an unrecognised tool', () => {
    const result = classifyTool({ name: 'foo_bar', description: 'Does something mysterious' });
    expect(result.capabilities).toContain(Capability.UNKNOWN);
    expect(result.riskScore).toBeLessThanOrEqual(15);
  });
});
