import { describe, it, expect } from 'vitest';
import { classifyTool } from '../classifier.js';
import type { ClassificationEvidence } from '../classifier.js';
import { Capability } from '@iseemp/core';

describe('classifyTool — safe-mcp fixtures', () => {
  it('classifies read_file correctly', () => {
    const result = classifyTool({ name: 'read_file', description: 'Read a local file by path' });
    expect(result.capabilities).toContain(Capability.READ_LOCAL_FILE);
    expect(result.riskScore).toBeGreaterThanOrEqual(30);
  });

  it('classifies write_file correctly', () => {
    const result = classifyTool({
      name: 'write_file',
      description: 'Write content to a local file',
    });
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
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' }, connectionString: { type: 'string' } },
      },
    });
    expect(result.capabilities).toContain(Capability.QUERY_DATABASE);
  });

  it('classifies send_http_request correctly', () => {
    const result = classifyTool({
      name: 'send_http_request',
      description: 'Make an HTTP request to a URL',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string' }, method: { type: 'string' } },
      },
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
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, repo: { type: 'string' } },
      },
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
    expect(result.isInstructionCapable).toBe(true);
    expect(result.isUntrusted).toBe(true);
    expect(result.contentOrigin).toBe('user_generated');
    expect(result.sourceRole).toContain('INSTRUCTION_SOURCE');
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
    expect(result.isInstructionCapable).toBe(true);
    expect(result.contentOrigin).toBe('remote');
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

// ---------------------------------------------------------------------------
// Classification evidence tests
// ---------------------------------------------------------------------------

/** Helper: find the first evidence entry for a given capability. */
function evidenceFor(
  ev: ClassificationEvidence[],
  cap: Capability,
): ClassificationEvidence | undefined {
  return ev.find((e) => e.capability === cap);
}

describe('classifyTool — evidence: credential / secret tools', () => {
  it('get_secret emits evidence for READ_CREDENTIAL_HIGH, READ_SECRET_HIGH, and READ_SECRET', () => {
    const result = classifyTool({ name: 'get_secret', description: 'Read a secret from the vault' });

    expect(result.capabilities).toContain(Capability.READ_CREDENTIAL_HIGH);
    expect(result.capabilities).toContain(Capability.READ_SECRET_HIGH);
    expect(result.capabilities).toContain(Capability.READ_SECRET);

    const credEv = evidenceFor(result.evidence, Capability.READ_CREDENTIAL_HIGH);
    expect(credEv).toBeDefined();
    expect(credEv!.source).toBe('combined');
    expect(credEv!.matched).toBeTruthy();
    expect(credEv!.reason).toBeTruthy();

    const secretHighEv = evidenceFor(result.evidence, Capability.READ_SECRET_HIGH);
    expect(secretHighEv).toBeDefined();
    expect(secretHighEv!.source).toBe('combined');

    const legacyEv = evidenceFor(result.evidence, Capability.READ_SECRET);
    expect(legacyEv).toBeDefined();
    expect(legacyEv!.reason).toMatch(/legacy/i);
  });

  it('read_env_vars evidence identifies the matched credential token', () => {
    const result = classifyTool({
      name: 'read_env_vars',
      description: 'Read environment variables from the host',
    });
    const credEv = evidenceFor(result.evidence, Capability.READ_CREDENTIAL_HIGH);
    expect(credEv).toBeDefined();
    // "env_var" or "env_vars" token should appear in the matched field
    expect(credEv!.matched).toMatch(/env_var/);
  });

  it('list_secret_scanning_alerts evidence: source is "combined" for credential token', () => {
    const result = classifyTool({
      name: 'list_secret_scanning_alerts',
      description: 'List secret scanning alerts in a repository',
    });
    const ev = evidenceFor(result.evidence, Capability.READ_CREDENTIAL_HIGH);
    expect(ev).toBeDefined();
    expect(ev!.source).toBe('combined');
    expect(ev!.matched).toBeTruthy();
    // Must NOT have untrusted content evidence
    expect(evidenceFor(result.evidence, Capability.UNTRUSTED_CONTENT_EXPOSURE)).toBeUndefined();
  });
});

describe('classifyTool — evidence: fetch / web tools', () => {
  it('fetch_url emits evidence for UNTRUSTED_CONTENT_EXPOSURE and INSTRUCTION_SOURCE', () => {
    const result = classifyTool({
      name: 'fetch_url',
      description: 'Fetch content from an arbitrary URL',
    });

    const untrustedEv = evidenceFor(result.evidence, Capability.UNTRUSTED_CONTENT_EXPOSURE);
    expect(untrustedEv).toBeDefined();
    expect(untrustedEv!.source).toBe('name');
    expect(untrustedEv!.matched).toContain('fetch');

    const instrEv = evidenceFor(result.evidence, Capability.INSTRUCTION_SOURCE);
    expect(instrEv).toBeDefined();
    expect(instrEv!.source).toBe('name');
  });

  it('fetch_url emits evidence for SEND_HTTP and derived SEND_EXTERNAL', () => {
    const result = classifyTool({
      name: 'fetch_url',
      description: 'Fetch content from an arbitrary URL',
    });

    const httpEv = evidenceFor(result.evidence, Capability.SEND_HTTP);
    expect(httpEv).toBeDefined();

    const extEv = evidenceFor(result.evidence, Capability.SEND_EXTERNAL);
    expect(extEv).toBeDefined();
    expect(extEv!.source).toBe('derived');
    expect(extEv!.matched).toBe('SEND_HTTP');
    expect(extEv!.reason).toMatch(/SEND_HTTP/);
  });

  it('web_fetch emits untrusted content evidence', () => {
    const result = classifyTool({
      name: 'web_fetch',
      description: 'Fetch a web page from an arbitrary URL',
    });
    const ev = evidenceFor(result.evidence, Capability.UNTRUSTED_CONTENT_EXPOSURE);
    expect(ev).toBeDefined();
    expect(ev!.source).toBe('name');
  });

  it('send_http_request SEND_EXTERNAL evidence is derived from SEND_HTTP', () => {
    const result = classifyTool({
      name: 'send_http_request',
      description: 'Make an HTTP request to a URL',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string' }, method: { type: 'string' } },
      },
    });
    const extEv = evidenceFor(result.evidence, Capability.SEND_EXTERNAL);
    expect(extEv).toBeDefined();
    expect(extEv!.source).toBe('derived');
    expect(extEv!.matched).toBe('SEND_HTTP');
  });
});

describe('classifyTool — evidence: GitHub / remote read tools', () => {
  it('search_repositories evidence identifies SaaS context + search/get verb', () => {
    const result = classifyTool({
      name: 'search_repositories',
      description: 'Search GitHub repositories',
    });

    expect(result.capabilities).not.toContain(Capability.EXECUTE_CODE);
    expect(result.capabilities).not.toContain(Capability.RUN_SHELL);

    const queryEv = evidenceFor(result.evidence, Capability.QUERY_REMOTE_SYSTEM);
    expect(queryEv).toBeDefined();
    expect(queryEv!.source).toBe('combined');

    const readEv = evidenceFor(result.evidence, Capability.READ_REMOTE_DATA);
    expect(readEv).toBeDefined();
  });

  it('issue_read evidence: QUERY_REMOTE_SYSTEM from name match, UNTRUSTED from name match', () => {
    const result = classifyTool({
      name: 'issue_read',
      description: 'Read a GitHub issue from a repository',
    });

    const queryEv = evidenceFor(result.evidence, Capability.QUERY_REMOTE_SYSTEM);
    expect(queryEv).toBeDefined();
    expect(queryEv!.source).toBe('name');
    expect(queryEv!.matched).toContain('issue_read');

    const untrustedEv = evidenceFor(result.evidence, Capability.UNTRUSTED_CONTENT_EXPOSURE);
    expect(untrustedEv).toBeDefined();
    expect(untrustedEv!.source).toBe('name');
    expect(untrustedEv!.matched).toContain('issue_read');
  });

  it('list_issues evidence: untrusted content from name pattern', () => {
    const result = classifyTool({
      name: 'list_issues',
      description: 'List issues in a GitHub repository',
    });
    const ev = evidenceFor(result.evidence, Capability.UNTRUSTED_CONTENT_EXPOSURE);
    expect(ev).toBeDefined();
    expect(ev!.source).toBe('name');
    expect(ev!.matched).toContain('list_issues');
  });

  it('list_commits evidence: source is "combined" for remoteSaas + list verb', () => {
    const result = classifyTool({
      name: 'list_commits',
      description: 'List commits in a GitHub repository',
    });
    expect(result.capabilities).toContain(Capability.QUERY_REMOTE_SYSTEM);
    expect(result.capabilities).toContain(Capability.READ_REMOTE_DATA);
    expect(result.capabilities).not.toContain(Capability.EXECUTE_CODE);

    const queryEv = evidenceFor(result.evidence, Capability.QUERY_REMOTE_SYSTEM);
    expect(queryEv).toBeDefined();
    expect(queryEv!.source).toBe('combined');
  });

  it('list_releases evidence: READ_METADATA_LOW from name pattern', () => {
    const result = classifyTool({
      name: 'list_releases',
      description: 'List releases in a GitHub repository',
    });
    const ev = evidenceFor(result.evidence, Capability.READ_METADATA_LOW);
    expect(ev).toBeDefined();
    expect(ev!.source).toBe('name');
    expect(ev!.matched).toContain('list_releases');
  });
});

describe('classifyTool — evidence: local filesystem tools', () => {
  it('read_file evidence: source is "name" with local file pattern', () => {
    const result = classifyTool({ name: 'read_file', description: 'Read a local file by path' });
    const ev = evidenceFor(result.evidence, Capability.READ_LOCAL_FILE);
    expect(ev).toBeDefined();
    expect(ev!.source).toBe('name');
    expect(ev!.matched).toBe('read_file');
  });

  it('list_directory evidence: source is "name"', () => {
    const result = classifyTool({
      name: 'list_directory',
      description: 'List files and folders in a local directory',
    });
    const ev = evidenceFor(result.evidence, Capability.READ_LOCAL_FILE);
    expect(ev).toBeDefined();
    expect(ev!.source).toBe('name');
  });

  it('a tool with filesystem token in description has source "combined"', () => {
    const result = classifyTool({
      name: 'get_content',
      description: 'Read from the local filesystem',
    });
    // "local file" token should fire since description contains it
    const ev = evidenceFor(result.evidence, Capability.READ_LOCAL_FILE);
    expect(ev).toBeDefined();
    expect(ev!.source).toBe('combined');
    expect(ev!.matched).toBeTruthy();
  });
});

describe('classifyTool — evidence: schema parameter hints', () => {
  it('command parameter evidence: source is "schema", matched is "command"', () => {
    const result = classifyTool({
      name: 'do_thing',
      description: 'Do a thing',
      inputSchema: { type: 'object', properties: { command: { type: 'string' } } },
    });
    const ev = evidenceFor(result.evidence, Capability.RUN_SHELL);
    expect(ev).toBeDefined();
    expect(ev!.source).toBe('schema');
    expect(ev!.matched).toBe('command');
    expect(ev!.reason).toMatch(/command/i);
  });

  it('url parameter evidence: source is "schema", matched is "url"', () => {
    const result = classifyTool({
      name: 'fetch_data',
      description: 'Fetch some data',
      inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
    });
    const ev = evidenceFor(result.evidence, Capability.READ_REMOTE_DATA);
    expect(ev).toBeDefined();
    expect(ev!.source).toBe('schema');
    expect(ev!.matched).toBe('url');
  });

  it('path parameter evidence: source is "schema", matched is "path"', () => {
    const result = classifyTool({
      name: 'read_content',
      description: 'Get content',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    });
    const ev = evidenceFor(result.evidence, Capability.READ_LOCAL_FILE);
    expect(ev).toBeDefined();
    expect(ev!.source).toBe('schema');
    expect(ev!.matched).toBe('path');
    expect(ev!.reason).toMatch(/path/i);
  });
});

describe('classifyTool — evidence: derived SEND_EXTERNAL', () => {
  it('SEND_EXTERNAL evidence always has source="derived" and matched="SEND_HTTP"', () => {
    const tools = [
      { name: 'http_request', description: 'Make an HTTP request' },
      { name: 'webhook', description: 'Send a webhook payload' },
      { name: 'curl', description: 'Execute a curl request' },
    ];
    for (const t of tools) {
      const result = classifyTool(t);
      expect(result.capabilities).toContain(Capability.SEND_EXTERNAL);
      const extEv = evidenceFor(result.evidence, Capability.SEND_EXTERNAL);
      expect(extEv).toBeDefined();
      expect(extEv!.source).toBe('derived');
      expect(extEv!.matched).toBe('SEND_HTTP');
    }
  });
});

describe('classifyTool — evidence: repository mutation', () => {
  it('push_files emits MUTATE_REPOSITORY evidence from name', () => {
    const result = classifyTool({
      name: 'push_files',
      description: 'Push files to a GitHub repository',
    });
    const repoEv = evidenceFor(result.evidence, Capability.MUTATE_REPOSITORY);
    expect(repoEv).toBeDefined();
    expect(repoEv!.source).toBe('name');
    expect(repoEv!.matched).toContain('push_files');

    const stateEv = evidenceFor(result.evidence, Capability.MUTATE_REMOTE_STATE);
    expect(stateEv).toBeDefined();
    expect(stateEv!.source).toBe('name');
  });

  it('create_issue emits MUTATE_ISSUE_OR_PR evidence from name', () => {
    const result = classifyTool({
      name: 'create_issue',
      description: 'Create a GitHub issue in a repository',
    });
    const ev = evidenceFor(result.evidence, Capability.MUTATE_ISSUE_OR_PR);
    expect(ev).toBeDefined();
    expect(ev!.source).toBe('name');
    expect(ev!.matched).toContain('create_issue');
  });
});

describe('classifyTool — evidence: every capability has evidence', () => {
  it('all capabilities in the result have a corresponding evidence entry', () => {
    const tools = [
      { name: 'get_secret', description: 'Read secrets from vault' },
      { name: 'fetch_url', description: 'Fetch a URL' },
      { name: 'push_files', description: 'Push files to GitHub' },
      { name: 'read_file', description: 'Read local file' },
      { name: 'execute_python', description: 'Run Python code' },
      { name: 'query_database', description: 'Query a database' },
    ];
    for (const t of tools) {
      const result = classifyTool(t);
      for (const cap of result.capabilities) {
        expect(
          result.evidence.some((e) => e.capability === cap),
          `Missing evidence for ${cap} in tool "${t.name}"`,
        ).toBe(true);
      }
    }
  });
});
