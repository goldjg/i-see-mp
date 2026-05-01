import { Capability } from '@iseemp/core';
import type { McpTool } from '@iseemp/core';

export interface ClassificationResult {
  capabilities: Capability[];
  riskScore: number;
}

// Higher score = more dangerous. Used to derive a numeric risk score per tool.
const CAPABILITY_SCORES: Record<Capability, number> = {
  [Capability.RUN_SHELL]: 95,
  [Capability.EXECUTE_CODE]: 90,
  [Capability.READ_CREDENTIAL_HIGH]: 85,
  [Capability.READ_SECRET_HIGH]: 80,
  [Capability.READ_SECRET]: 80, // legacy alias
  [Capability.MUTATE_IDENTITY]: 80,
  [Capability.MUTATE_CLOUD_RESOURCE]: 75,
  [Capability.MUTATE_REPOSITORY]: 65,
  [Capability.EXPORT_DATA]: 70,
  [Capability.SEND_EXTERNAL]: 65,
  [Capability.SEND_HTTP]: 55,
  [Capability.READ_SENSITIVE_MEDIUM]: 55,
  [Capability.WRITE_LOCAL_FILE]: 55,
  [Capability.WRITE_REMOTE_DATA]: 50,
  [Capability.MUTATE_REMOTE_STATE]: 45,
  [Capability.MUTATE_ISSUE_OR_PR]: 40,
  [Capability.QUERY_DATABASE]: 50,
  [Capability.SEND_EMAIL]: 60,
  [Capability.CREATE_TICKET]: 35,
  [Capability.READ_REMOTE_DATA]: 25,
  [Capability.READ_LOCAL_FILE]: 30,
  [Capability.QUERY_REMOTE_SYSTEM]: 20,
  [Capability.READ_METADATA_LOW]: 15,
  [Capability.UNKNOWN]: 10,
};

function matchesAny(text: string, patterns: string[]): boolean {
  return patterns.some((p) => text.includes(p));
}

/** Match whole-word-ish — pattern must appear as an isolated token, not as a substring of another word. */
function matchesToken(text: string, tokens: string[]): boolean {
  return tokens.some((t) => {
    const re = new RegExp(`(^|[^a-z0-9])${t.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}([^a-z0-9]|$)`);
    return re.test(text);
  });
}

function getSchemaParams(tool: McpTool): string[] {
  const schema = tool.inputSchema;
  if (!schema || typeof schema !== 'object') return [];
  const props = (schema as Record<string, unknown>)['properties'];
  if (!props || typeof props !== 'object') return [];
  return Object.keys(props as Record<string, unknown>).map((k) => k.toLowerCase());
}

/** Heuristic: is this tool talking to a remote SaaS / repo host (GitHub, GitLab, Bitbucket, Jira, ...)? */
function isRemoteSaasContext(text: string): boolean {
  return matchesAny(text, [
    'github',
    'gitlab',
    'bitbucket',
    'jira',
    'linear',
    'asana',
    'trello',
    'slack',
    'discord',
    'notion',
    'confluence',
  ]);
}

export function classifyTool(tool: McpTool): ClassificationResult {
  const caps = new Set<Capability>();
  const name = tool.name.toLowerCase();
  const desc = (tool.description ?? '').toLowerCase();
  const combined = `${name} ${desc}`;
  const params = getSchemaParams(tool);
  const remoteSaas = isRemoteSaasContext(combined);

  // ---------- Shell execution (very narrow) ----------
  // Only fire RUN_SHELL when the tool clearly executes shell commands or scripts.
  const shellNamePatterns = [
    'run_shell',
    'shell_exec',
    'execute_shell',
    'exec_shell',
    'run_command',
    'execute_command',
    'run_bash',
    'bash_exec',
    'execute_bash',
    'spawn',
    'subprocess',
    'system_command',
  ];
  const shellTokens = ['bash', 'shell', 'terminal', 'cmd.exe', 'powershell', 'subprocess'];
  if (
    matchesAny(name, shellNamePatterns) ||
    matchesToken(combined, shellTokens) ||
    /\bexecutes?\s+(a\s+)?(shell|bash|terminal|os|system)\s+command/.test(combined) ||
    /\brun(s)?\s+(a\s+)?(shell|bash|terminal|os|system)\s+command/.test(combined)
  ) {
    caps.add(Capability.RUN_SHELL);
  }

  // ---------- Code execution (narrow) ----------
  // Only fire EXECUTE_CODE for tools that clearly evaluate code in an interpreter / sandbox.
  const codeExecNamePatterns = [
    'execute_code',
    'eval_code',
    'run_code',
    'execute_python',
    'run_python',
    'python_exec',
    'execute_javascript',
    'run_javascript',
    'execute_js',
    'run_js',
    'execute_node',
    'run_node',
    'execute_script',
    'run_script',
    'python_repl',
    'js_repl',
    'node_repl',
    'eval_expression',
  ];
  const codeExecTokens = ['eval', 'repl', 'interpreter'];
  if (
    matchesAny(name, codeExecNamePatterns) ||
    matchesToken(combined, codeExecTokens) ||
    /\b(execute|run|evaluate|interpret)s?\s+(arbitrary\s+)?(python|javascript|typescript|node|js|ruby|code)\b/.test(combined) ||
    /\b(python|javascript|node|js|ruby)\s+(code|script)\s+(execution|interpreter|repl)/.test(combined)
  ) {
    caps.add(Capability.EXECUTE_CODE);
  }

  // ---------- Sensitive credentials / secrets ----------
  // HIGH: actual secrets/credentials/keys
  const credentialTokens = [
    'secret',
    'secrets',
    'password',
    'passwords',
    'token',
    'tokens',
    'credential',
    'credentials',
    'api_key',
    'apikey',
    'api-key',
    'private_key',
    'access_key',
    'auth_token',
    'authentication_token',
    'vault',
    'env_var',
    'env_vars',
    'environment_variable',
    'environment_variables',
    'dotenv',
    '.env',
  ];
  if (matchesToken(combined, credentialTokens)) {
    caps.add(Capability.READ_CREDENTIAL_HIGH);
    caps.add(Capability.READ_SECRET_HIGH);
    // Keep legacy READ_SECRET in the output for back-compat consumers
    caps.add(Capability.READ_SECRET);
  }

  // ---------- Sensitive (medium) — team / org / collaborator metadata ----------
  const sensitiveMediumPatterns = [
    'team_member',
    'team_members',
    'get_teams',
    'list_teams',
    'list_team',
    'collaborator',
    'collaborators',
    'org_member',
    'org_members',
    'organization_member',
    'organization_members',
    'list_members',
    'list_organisation_members',
  ];
  if (matchesAny(name, sensitiveMediumPatterns)) {
    caps.add(Capability.READ_SENSITIVE_MEDIUM);
  }

  // ---------- Low-sensitivity public metadata ----------
  // Public, low-risk metadata reads on remote SaaS (releases, tags, labels, public branches, ...)
  const lowMetadataPatterns = [
    'read_metadata',
    'list_releases',
    'get_release',
    'get_latest_release',
    'list_tags',
    'get_tag',
    'list_labels',
    'get_label',
    'list_branches',
  ];
  if (matchesAny(name, lowMetadataPatterns)) {
    caps.add(Capability.READ_METADATA_LOW);
  }

  // ---------- Repository mutation (write to repo contents/structure) ----------
  const mutateRepoPatterns = [
    'create_repository',
    'create_repo',
    'delete_repository',
    'delete_repo',
    'fork_repo',
    'fork_repository',
    'create_or_update_file',
    'update_file',
    'delete_file',
    'push_files',
    'push_file',
    'create_branch',
    'delete_branch',
    'create_tag',
    'create_release',
  ];
  if (matchesAny(name, mutateRepoPatterns)) {
    caps.add(Capability.MUTATE_REPOSITORY);
    caps.add(Capability.MUTATE_REMOTE_STATE);
  }

  // ---------- Issue / PR / Comment / Review mutation ----------
  const mutateIssuePrPatterns = [
    'create_issue',
    'update_issue',
    'close_issue',
    'reopen_issue',
    'lock_issue',
    'unlock_issue',
    'add_issue_comment',
    'create_issue_comment',
    'update_issue_comment',
    'create_pull_request',
    'create_pr',
    'update_pull_request',
    'merge_pull_request',
    'close_pull_request',
    'pull_request_review_write',
    'submit_pull_request_review',
    'add_reply_to_pull_request_comment',
    'reply_to_pull_request_comment',
    'create_pull_request_review',
    'add_review_comment',
    'request_review',
    'add_label',
    'remove_label',
    'assign_issue',
    'unassign_issue',
  ];
  if (matchesAny(name, mutateIssuePrPatterns)) {
    caps.add(Capability.MUTATE_ISSUE_OR_PR);
    caps.add(Capability.MUTATE_REMOTE_STATE);
  }

  if (matchesAny(name, ['mutate_remote_state', 'update_remote_state', 'modify_remote_state'])) {
    caps.add(Capability.MUTATE_REMOTE_STATE);
  }

  // ---------- Generic remote-mutation hints ----------
  // Any *_write/_update/_create/_delete on a remote SaaS context that we haven't classified yet
  if (
    remoteSaas &&
    !caps.has(Capability.MUTATE_REPOSITORY) &&
    !caps.has(Capability.MUTATE_ISSUE_OR_PR) &&
    !caps.has(Capability.MUTATE_REMOTE_STATE) &&
    /(^|_)(write|update|create|delete|merge|patch|publish)(_|$)/.test(name)
  ) {
    caps.add(Capability.MUTATE_REMOTE_STATE);
  }

  // ---------- Query / search remote system ----------
  // search_*, list_*, get_* on remote SaaS → query+read remote data, NOT execute.
  if (remoteSaas && /(^|_)(search|list|get)(_|$)/.test(name)) {
    caps.add(Capability.QUERY_REMOTE_SYSTEM);
    caps.add(Capability.READ_REMOTE_DATA);
  }
  // Even outside known SaaS, search_* implies remote query
  if (/^(search|query)_/.test(name) && !caps.has(Capability.QUERY_DATABASE)) {
    caps.add(Capability.QUERY_REMOTE_SYSTEM);
    caps.add(Capability.READ_REMOTE_DATA);
  }

  // ---------- File reads ----------
  // Distinguish local file read vs remote file content read.
  const localFileNamePatterns = ['read_file', 'open_file', 'cat_file', 'read_local'];
  const localFileTokens = ['filesystem', 'file system', 'local file', 'local disk'];
  const isLocalFileRead =
    matchesAny(name, localFileNamePatterns) || matchesToken(combined, localFileTokens);
  if (isLocalFileRead && !remoteSaas) {
    caps.add(Capability.READ_LOCAL_FILE);
  }

  // get_file_contents from remote SaaS → READ_REMOTE_DATA, not local file
  if (/get_file_contents?$/.test(name) || /get_file_content$/.test(name) || /^get_content$/.test(name)) {
    if (remoteSaas) {
      caps.add(Capability.READ_REMOTE_DATA);
    } else {
      caps.add(Capability.READ_LOCAL_FILE);
    }
  }

  // ---------- File writes ----------
  if (
    matchesAny(name, [
      'write_file',
      'save_file',
      'create_file',
      'put_file',
      'append_file',
      'delete_file',
      'remove_file',
      'rename_file',
      'move_file',
      'copy_file',
      'mkdir',
      'rmdir',
    ]) &&
    !remoteSaas
  ) {
    caps.add(Capability.WRITE_LOCAL_FILE);
  }

  // ---------- HTTP / network ----------
  if (
    matchesAny(name, [
      'http_request',
      'send_request',
      'web_request',
      'webhook',
      'fetch_url',
      'curl',
    ]) ||
    matchesToken(combined, ['http', 'https', 'fetch', 'webhook'])
  ) {
    caps.add(Capability.SEND_HTTP);
  }

  // SEND_EXTERNAL: explicit external send (webhooks, email, generic outbound HTTP that crosses
  // a trust boundary). For now we infer it whenever SEND_HTTP is present and there's no clear
  // indication the destination is internal-only.
  if (caps.has(Capability.SEND_HTTP)) {
    caps.add(Capability.SEND_EXTERNAL);
  }

  // ---------- Email ----------
  if (matchesAny(name, ['send_email', 'send_mail']) || matchesToken(combined, ['smtp', 'sendgrid', 'mailgun'])) {
    caps.add(Capability.SEND_EMAIL);
    caps.add(Capability.SEND_EXTERNAL);
  }

  // ---------- Database ----------
  if (
    matchesAny(name, ['query_database', 'db_query', 'run_query', 'sql_query']) ||
    matchesToken(combined, ['sqlite', 'postgres', 'mysql', 'mongodb', 'sql'])
  ) {
    caps.add(Capability.QUERY_DATABASE);
  }

  // ---------- Identity / IAM ----------
  if (
    matchesAny(name, [
      'assume_role',
      'create_user',
      'delete_user',
      'add_user',
      'manage_user',
      'create_role',
      'attach_policy',
      'detach_policy',
    ]) ||
    matchesToken(combined, ['iam', 'rbac', 'acl'])
  ) {
    caps.add(Capability.MUTATE_IDENTITY);
  }

  // ---------- Cloud resources ----------
  if (
    matchesToken(combined, [
      'aws',
      'azure',
      'gcp',
      's3',
      'ec2',
      'lambda',
      'cloudformation',
      'terraform',
      'kubernetes',
      'k8s',
    ])
  ) {
    caps.add(Capability.MUTATE_CLOUD_RESOURCE);
  }

  // ---------- Export / data exfil ----------
  if (matchesAny(name, ['export_all', 'bulk_export', 'data_export', 'dump_all', 'backup_all'])) {
    caps.add(Capability.EXPORT_DATA);
  }

  // ---------- Schema parameter hints ----------
  if (
    (params.includes('path') ||
      params.includes('filepath') ||
      params.includes('file_path') ||
      params.includes('filename')) &&
    !remoteSaas &&
    !caps.has(Capability.WRITE_LOCAL_FILE) &&
    !caps.has(Capability.READ_REMOTE_DATA)
  ) {
    caps.add(Capability.READ_LOCAL_FILE);
  }
  if (params.some((p) => p === 'url' || p === 'endpoint' || p === 'uri' || p === 'base_url')) {
    if (!caps.has(Capability.SEND_HTTP)) {
      caps.add(Capability.READ_REMOTE_DATA);
    } else if (matchesAny(combined, ['fetch', 'get', 'read', 'retrieve', 'load', 'download'])) {
      caps.add(Capability.READ_REMOTE_DATA);
    }
  }
  if (params.some((p) => p === 'query' || p === 'sql') && /sql|database|db/.test(combined)) {
    caps.add(Capability.QUERY_DATABASE);
  }
  if (params.some((p) => p === 'command' || p === 'cmd' || p === 'shell')) {
    caps.add(Capability.RUN_SHELL);
  }

  // ---------- Fallback ----------
  if (caps.size === 0) {
    caps.add(Capability.UNKNOWN);
  }

  const capsArray = Array.from(caps);
  const baseScore = Math.max(...capsArray.map((c) => CAPABILITY_SCORES[c] ?? 10));

  // Bonus for multiple dangerous capabilities (>=55 score)
  const dangerousCaps = capsArray.filter((c) => (CAPABILITY_SCORES[c] ?? 0) >= 55).length;
  const bonus = dangerousCaps > 1 ? Math.min(dangerousCaps * 5, 10) : 0;

  return {
    capabilities: capsArray,
    riskScore: Math.min(baseScore + bonus, 100),
  };
}
