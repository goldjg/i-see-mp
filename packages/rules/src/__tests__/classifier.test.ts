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

  it('classifies run_shell as RUN_SHELL (high risk), not EXECUTE_CODE', () => {
    const result = classifyTool({ name: 'run_shell', description: 'Execute a shell command' });
    expect(result.capabilities).toContain(Capability.RUN_SHELL);
    // Should NOT also blanket-set EXECUTE_CODE — they are distinct.
    expect(result.capabilities).not.toContain(Capability.EXECUTE_CODE);
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
    expect(result.capabilities).toContain(Capability.SEND_EXTERNAL);
    expect(result.riskScore).toBeGreaterThanOrEqual(55);
  });
});

describe('classifyTool — GitHub MCP shaped tools (precise)', () => {
  it('search_repositories is QUERY_REMOTE_SYSTEM/READ_REMOTE_DATA, NOT EXECUTE_CODE', () => {
    const result = classifyTool({
      name: 'search_repositories',
      description: 'Search GitHub repositories',
    });
    expect(result.capabilities).toContain(Capability.QUERY_REMOTE_SYSTEM);
    expect(result.capabilities).toContain(Capability.READ_REMOTE_DATA);
    expect(result.capabilities).not.toContain(Capability.EXECUTE_CODE);
    expect(result.capabilities).not.toContain(Capability.RUN_SHELL);
    expect(result.riskScore).toBeLessThan(60);
  });

  it('add_reply_to_pull_request_comment is MUTATE_ISSUE_OR_PR / MUTATE_REMOTE_STATE, not EXECUTE_CODE', () => {
    const result = classifyTool({
      name: 'add_reply_to_pull_request_comment',
      description: 'Reply to a pull request review comment on GitHub',
    });
    expect(result.capabilities).toContain(Capability.MUTATE_ISSUE_OR_PR);
    expect(result.capabilities).toContain(Capability.MUTATE_REMOTE_STATE);
    expect(result.capabilities).not.toContain(Capability.EXECUTE_CODE);
    expect(result.capabilities).not.toContain(Capability.RUN_SHELL);
  });

  it('pull_request_review_write is MUTATE_ISSUE_OR_PR / MUTATE_REMOTE_STATE, not EXECUTE_CODE', () => {
    const result = classifyTool({
      name: 'pull_request_review_write',
      description: 'Submit a pull request review on GitHub',
    });
    expect(result.capabilities).toContain(Capability.MUTATE_ISSUE_OR_PR);
    expect(result.capabilities).toContain(Capability.MUTATE_REMOTE_STATE);
    expect(result.capabilities).not.toContain(Capability.EXECUTE_CODE);
    expect(result.capabilities).not.toContain(Capability.RUN_SHELL);
  });

  it('get_team_members is READ_SENSITIVE_MEDIUM / READ_REMOTE_DATA, not READ_SECRET_HIGH', () => {
    const result = classifyTool({
      name: 'get_team_members',
      description: 'Get members of a GitHub team',
    });
    expect(result.capabilities).toContain(Capability.READ_SENSITIVE_MEDIUM);
    expect(result.capabilities).toContain(Capability.READ_REMOTE_DATA);
    expect(result.capabilities).not.toContain(Capability.READ_SECRET_HIGH);
    expect(result.capabilities).not.toContain(Capability.READ_CREDENTIAL_HIGH);
  });

  it('get_teams is READ_SENSITIVE_MEDIUM / READ_REMOTE_DATA', () => {
    const result = classifyTool({
      name: 'get_teams',
      description: 'List GitHub teams in an organisation',
    });
    expect(result.capabilities).toContain(Capability.READ_SENSITIVE_MEDIUM);
    expect(result.capabilities).toContain(Capability.READ_REMOTE_DATA);
  });

  it('get_file_contents on GitHub is READ_REMOTE_DATA, NOT READ_LOCAL_FILE', () => {
    const result = classifyTool({
      name: 'get_file_contents',
      description: 'Get the contents of a file from a GitHub repository',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, repo: { type: 'string' } } },
    });
    expect(result.capabilities).toContain(Capability.READ_REMOTE_DATA);
    expect(result.capabilities).not.toContain(Capability.READ_LOCAL_FILE);
  });

  it('push_files is MUTATE_REPOSITORY / MUTATE_REMOTE_STATE', () => {
    const result = classifyTool({
      name: 'push_files',
      description: 'Push files to a GitHub repository',
    });
    expect(result.capabilities).toContain(Capability.MUTATE_REPOSITORY);
    expect(result.capabilities).toContain(Capability.MUTATE_REMOTE_STATE);
  });

  it('create_issue is MUTATE_ISSUE_OR_PR', () => {
    const result = classifyTool({
      name: 'create_issue',
      description: 'Create a GitHub issue in a repository',
    });
    expect(result.capabilities).toContain(Capability.MUTATE_ISSUE_OR_PR);
  });

  it('issue_write is MUTATE_ISSUE_OR_PR', () => {
    const result = classifyTool({
      name: 'issue_write',
      description: 'Create or update a GitHub issue in a repository',
    });
    expect(result.capabilities).toContain(Capability.MUTATE_ISSUE_OR_PR);
  });

  it('issue_read on GitHub is QUERY_REMOTE_SYSTEM / READ_REMOTE_DATA', () => {
    const result = classifyTool({
      name: 'issue_read',
      description: 'Read a GitHub issue from a repository',
    });
    expect(result.capabilities).toContain(Capability.QUERY_REMOTE_SYSTEM);
    expect(result.capabilities).toContain(Capability.READ_REMOTE_DATA);
    expect(result.capabilities).toContain(Capability.UNTRUSTED_CONTENT_EXPOSURE);
  });

  it('list_issues is UNTRUSTED_CONTENT_EXPOSURE', () => {
    const result = classifyTool({
      name: 'list_issues',
      description: 'List issues in a GitHub repository',
    });
    expect(result.capabilities).toContain(Capability.UNTRUSTED_CONTENT_EXPOSURE);
  });

  it('search_pull_requests is UNTRUSTED_CONTENT_EXPOSURE', () => {
    const result = classifyTool({
      name: 'search_pull_requests',
      description: 'Search pull requests in GitHub repositories',
    });
    expect(result.capabilities).toContain(Capability.UNTRUSTED_CONTENT_EXPOSURE);
  });

  it('get_secret_scanning_alert is not UNTRUSTED_CONTENT_EXPOSURE', () => {
    const result = classifyTool({
      name: 'get_secret_scanning_alert',
      description: 'Get details of a specific secret scanning alert in a repository',
    });
    expect(result.capabilities).toContain(Capability.READ_CREDENTIAL_HIGH);
    expect(result.capabilities).toContain(Capability.READ_SECRET_HIGH);
    expect(result.capabilities).not.toContain(Capability.UNTRUSTED_CONTENT_EXPOSURE);
  });

  it('list_secret_scanning_alerts is not UNTRUSTED_CONTENT_EXPOSURE', () => {
    const result = classifyTool({
      name: 'list_secret_scanning_alerts',
      description: 'List secret scanning alerts in a repository',
    });
    expect(result.capabilities).toContain(Capability.READ_CREDENTIAL_HIGH);
    expect(result.capabilities).toContain(Capability.READ_SECRET_HIGH);
    expect(result.capabilities).not.toContain(Capability.UNTRUSTED_CONTENT_EXPOSURE);
  });

  it('list_tags is not UNTRUSTED_CONTENT_EXPOSURE', () => {
    const result = classifyTool({
      name: 'list_tags',
      description: 'List tags in a GitHub repository',
    });
    expect(result.capabilities).not.toContain(Capability.UNTRUSTED_CONTENT_EXPOSURE);
  });

  it('create_pull_request is MUTATE_ISSUE_OR_PR', () => {
    const result = classifyTool({
      name: 'create_pull_request',
      description: 'Create a pull request on GitHub',
    });
    expect(result.capabilities).toContain(Capability.MUTATE_ISSUE_OR_PR);
  });

  it('list_commits on GitHub is QUERY_REMOTE_SYSTEM / READ_REMOTE_DATA, low risk', () => {
    const result = classifyTool({
      name: 'list_commits',
      description: 'List commits in a GitHub repository',
    });
    expect(result.capabilities).toContain(Capability.QUERY_REMOTE_SYSTEM);
    expect(result.capabilities).toContain(Capability.READ_REMOTE_DATA);
    expect(result.capabilities).not.toContain(Capability.EXECUTE_CODE);
    expect(result.capabilities).not.toContain(Capability.RUN_SHELL);
    expect(result.riskScore).toBeLessThan(60);
  });

  it('list_releases on GitHub is READ_METADATA_LOW', () => {
    const result = classifyTool({
      name: 'list_releases',
      description: 'List releases in a GitHub repository',
    });
    expect(result.capabilities).toContain(Capability.READ_METADATA_LOW);
  });
});

describe('classifyTool — execution capabilities (narrow)', () => {
  it('run_shell_command is RUN_SHELL with high/critical score', () => {
    const result = classifyTool({
      name: 'run_shell_command',
      description: 'Run a shell command on the host',
    });
    expect(result.capabilities).toContain(Capability.RUN_SHELL);
    expect(result.riskScore).toBeGreaterThanOrEqual(90);
  });

  it('execute_python is EXECUTE_CODE with high/critical score', () => {
    const result = classifyTool({
      name: 'execute_python',
      description: 'Execute Python code in a sandbox',
    });
    expect(result.capabilities).toContain(Capability.EXECUTE_CODE);
    expect(result.riskScore).toBeGreaterThanOrEqual(85);
  });

  it('python_repl is EXECUTE_CODE', () => {
    const result = classifyTool({ name: 'python_repl', description: 'Python REPL' });
    expect(result.capabilities).toContain(Capability.EXECUTE_CODE);
  });

  it('command-parameter schema implies RUN_SHELL', () => {
    const result = classifyTool({
      name: 'do_thing',
      description: 'Do a thing',
      inputSchema: { type: 'object', properties: { command: { type: 'string' } } },
    });
    expect(result.capabilities).toContain(Capability.RUN_SHELL);
  });

  it('a tool whose description mentions "code review" is NOT EXECUTE_CODE', () => {
    const result = classifyTool({
      name: 'submit_review',
      description: 'Submit a code review on a pull request',
    });
    expect(result.capabilities).not.toContain(Capability.EXECUTE_CODE);
    expect(result.capabilities).not.toContain(Capability.RUN_SHELL);
  });
});

describe('classifyTool — credential reads', () => {
  it('get_secret is READ_CREDENTIAL_HIGH / READ_SECRET_HIGH', () => {
    const result = classifyTool({
      name: 'get_secret',
      description: 'Read a secret from the vault',
    });
    expect(result.capabilities).toContain(Capability.READ_CREDENTIAL_HIGH);
    expect(result.capabilities).toContain(Capability.READ_SECRET_HIGH);
  });

  it('read_env_vars is READ_CREDENTIAL_HIGH', () => {
    const result = classifyTool({
      name: 'read_env_vars',
      description: 'Read environment variables from the host',
    });
    expect(result.capabilities).toContain(Capability.READ_CREDENTIAL_HIGH);
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

  it('does NOT infer READ_LOCAL_FILE from path parameter on a remote SaaS tool', () => {
    const result = classifyTool({
      name: 'read_content',
      description: 'Get content from a GitHub repository',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    });
    expect(result.capabilities).not.toContain(Capability.READ_LOCAL_FILE);
  });

  it('infers READ_REMOTE_DATA from url parameter', () => {
    const result = classifyTool({
      name: 'fetch_data',
      description: 'Fetch some data',
      inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
    });
    expect(result.capabilities).toContain(Capability.READ_REMOTE_DATA);
  });

  it('classifies fetch_url as UNTRUSTED_CONTENT_EXPOSURE', () => {
    const result = classifyTool({
      name: 'fetch_url',
      description: 'Fetch content from an arbitrary URL',
    });
    expect(result.capabilities).toContain(Capability.UNTRUSTED_CONTENT_EXPOSURE);
  });

  it('classifies fetch as UNTRUSTED_CONTENT_EXPOSURE', () => {
    const result = classifyTool({
      name: 'fetch',
      description: 'Fetch content from arbitrary URL',
    });
    expect(result.capabilities).toContain(Capability.UNTRUSTED_CONTENT_EXPOSURE);
  });

  it('classifies web_fetch as UNTRUSTED_CONTENT_EXPOSURE', () => {
    const result = classifyTool({
      name: 'web_fetch',
      description: 'Fetch a web page from arbitrary URL',
    });
    expect(result.capabilities).toContain(Capability.UNTRUSTED_CONTENT_EXPOSURE);
  });
});

describe('classifyTool — filesystem MCP local/source-only tools', () => {
  it('classifies search_files as READ_LOCAL_FILE, not QUERY_REMOTE_SYSTEM', () => {
    const result = classifyTool({
      name: 'search_files',
      description: 'Recursively search local files for a pattern',
    });
    expect(result.capabilities).toContain(Capability.READ_LOCAL_FILE);
    expect(result.capabilities).not.toContain(Capability.QUERY_REMOTE_SYSTEM);
    expect(result.capabilities).not.toContain(Capability.SEND_HTTP);
    expect(result.capabilities).not.toContain(Capability.SEND_EXTERNAL);
  });

  it('classifies list_directory as READ_LOCAL_FILE', () => {
    const result = classifyTool({
      name: 'list_directory',
      description: 'List files and folders in a local directory',
    });
    expect(result.capabilities).toContain(Capability.READ_LOCAL_FILE);
    expect(result.capabilities).not.toContain(Capability.QUERY_REMOTE_SYSTEM);
    expect(result.capabilities).not.toContain(Capability.SEND_HTTP);
    expect(result.capabilities).not.toContain(Capability.SEND_EXTERNAL);
  });

  it('classifies directory_tree as READ_LOCAL_FILE', () => {
    const result = classifyTool({
      name: 'directory_tree',
      description: 'Show local directory tree',
    });
    expect(result.capabilities).toContain(Capability.READ_LOCAL_FILE);
    expect(result.capabilities).not.toContain(Capability.QUERY_REMOTE_SYSTEM);
    expect(result.capabilities).not.toContain(Capability.SEND_HTTP);
    expect(result.capabilities).not.toContain(Capability.SEND_EXTERNAL);
  });

  it('classifies get_file_info as READ_LOCAL_FILE', () => {
    const result = classifyTool({
      name: 'get_file_info',
      description: 'Read local file metadata',
    });
    expect(result.capabilities).toContain(Capability.READ_LOCAL_FILE);
    expect(result.capabilities).not.toContain(Capability.QUERY_REMOTE_SYSTEM);
    expect(result.capabilities).not.toContain(Capability.SEND_HTTP);
    expect(result.capabilities).not.toContain(Capability.SEND_EXTERNAL);
  });

  it('classifies list_allowed_directories as READ_LOCAL_FILE', () => {
    const result = classifyTool({
      name: 'list_allowed_directories',
      description: 'List locally-allowed filesystem roots',
    });
    expect(result.capabilities).toContain(Capability.READ_LOCAL_FILE);
    expect(result.capabilities).not.toContain(Capability.QUERY_REMOTE_SYSTEM);
    expect(result.capabilities).not.toContain(Capability.SEND_HTTP);
    expect(result.capabilities).not.toContain(Capability.SEND_EXTERNAL);
  });

  it('classifies read_multiple_files as READ_LOCAL_FILE', () => {
    const result = classifyTool({
      name: 'read_multiple_files',
      description: 'Read multiple local files by path',
    });
    expect(result.capabilities).toContain(Capability.READ_LOCAL_FILE);
    expect(result.capabilities).not.toContain(Capability.QUERY_REMOTE_SYSTEM);
    expect(result.capabilities).not.toContain(Capability.SEND_HTTP);
    expect(result.capabilities).not.toContain(Capability.SEND_EXTERNAL);
    expect(result.capabilities).not.toContain(Capability.UNTRUSTED_CONTENT_EXPOSURE);
  });

  it('classifies edit_file as WRITE_LOCAL_FILE', () => {
    const result = classifyTool({
      name: 'edit_file',
      description: 'Edit a local file',
    });
    expect(result.capabilities).toContain(Capability.WRITE_LOCAL_FILE);
    expect(result.capabilities).not.toContain(Capability.QUERY_REMOTE_SYSTEM);
    expect(result.capabilities).not.toContain(Capability.SEND_HTTP);
    expect(result.capabilities).not.toContain(Capability.SEND_EXTERNAL);
  });

  it('classifies create_directory as WRITE_LOCAL_FILE', () => {
    const result = classifyTool({
      name: 'create_directory',
      description: 'Create a local directory',
    });
    expect(result.capabilities).toContain(Capability.WRITE_LOCAL_FILE);
    expect(result.capabilities).not.toContain(Capability.QUERY_REMOTE_SYSTEM);
    expect(result.capabilities).not.toContain(Capability.SEND_HTTP);
    expect(result.capabilities).not.toContain(Capability.SEND_EXTERNAL);
  });
});

describe('classifyTool — UNKNOWN fallback', () => {
  it('returns UNKNOWN for an unrecognised tool', () => {
    const result = classifyTool({ name: 'foo_bar', description: 'Does something mysterious' });
    expect(result.capabilities).toContain(Capability.UNKNOWN);
    expect(result.riskScore).toBeLessThanOrEqual(15);
  });
});
