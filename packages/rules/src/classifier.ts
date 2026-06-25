import { Capability, ContentOrigin, SourceRole } from '@iseemp/core';
import type { McpTool } from '@iseemp/core';

/**
 * A single piece of deterministic evidence explaining why a capability was assigned.
 * Only positive matches that caused a capability to be added are recorded.
 */
export interface ClassificationEvidence {
  /** The capability that was assigned. */
  capability: Capability;
  /** Where the signal that triggered the assignment came from. */
  source: 'name' | 'description' | 'schema' | 'derived' | 'combined';
  /** The specific pattern, token, or value that matched. */
  matched: string;
  /** Human-readable explanation of why the match implies the capability. */
  reason: string;
}

export interface ClassificationResult {
  capabilities: Capability[];
  riskScore: number;
  sourceRole: SourceRole[];
  isUntrusted: boolean;
  isInstructionCapable: boolean;
  contentOrigin: ContentOrigin;
  /** Structured evidence for each capability assignment, including UNKNOWN fallback classification. */
  evidence: ClassificationEvidence[];
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
  [Capability.UNTRUSTED_CONTENT_EXPOSURE]: 45,
  [Capability.MUTATE_REMOTE_STATE]: 45,
  [Capability.MUTATE_ISSUE_OR_PR]: 40,
  [Capability.QUERY_DATABASE]: 50,
  [Capability.SEND_EMAIL]: 60,
  [Capability.CREATE_TICKET]: 35,
  [Capability.READ_REMOTE_DATA]: 25,
  [Capability.READ_LOCAL_FILE]: 30,
  [Capability.QUERY_REMOTE_SYSTEM]: 20,
  [Capability.READ_METADATA_LOW]: 15,
  [Capability.INSTRUCTION_SOURCE]: 50,
  [Capability.UNKNOWN]: 10,
};

function matchesAny(text: string, patterns: string[]): boolean {
  return patterns.some((p) => text.includes(p));
}

/** Like matchesAny but returns the first matching pattern, or null. */
function findMatch(text: string, patterns: string[]): string | null {
  return patterns.find((p) => text.includes(p)) ?? null;
}

/** Like matchesToken but returns the first matching token, or null. */
function findTokenMatch(text: string, tokens: string[]): string | null {
  return (
    tokens.find((t) => {
      const re = new RegExp(
        `(^|[^a-z0-9])${t.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}([^a-z0-9]|$)`,
      );
      return re.test(text);
    }) ?? null
  );
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
  const evidenceList: ClassificationEvidence[] = [];

  /**
   * Add a capability and record evidence for it.
   * Evidence is only recorded the first time a given capability is added, so
   * the entry reflects the primary signal that caused the assignment.
   */
  function addCap(
    cap: Capability,
    source: ClassificationEvidence['source'],
    matched: string,
    reason: string,
  ): void {
    const isNew = !caps.has(cap);
    caps.add(cap);
    if (isNew) {
      evidenceList.push({ capability: cap, source, matched, reason });
    }
  }

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
  {
    const matchedName = findMatch(name, shellNamePatterns);
    if (matchedName !== null) {
      addCap(
        Capability.RUN_SHELL,
        'name',
        matchedName,
        'tool name matches shell execution pattern',
      );
    } else {
      const matchedToken = findTokenMatch(combined, shellTokens);
      if (matchedToken !== null) {
        addCap(
          Capability.RUN_SHELL,
          'combined',
          matchedToken,
          'name/description contains shell execution keyword',
        );
      } else {
        const m =
          /\bexecutes?\s+(a\s+)?(shell|bash|terminal|os|system)\s+command/.exec(combined) ??
          /\brun(s)?\s+(a\s+)?(shell|bash|terminal|os|system)\s+command/.exec(combined);
        if (m) {
          addCap(
            Capability.RUN_SHELL,
            'combined',
            m[0],
            'description indicates shell command execution',
          );
        }
      }
    }
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
  {
    const matchedName = findMatch(name, codeExecNamePatterns);
    if (matchedName !== null) {
      addCap(
        Capability.EXECUTE_CODE,
        'name',
        matchedName,
        'tool name matches code execution pattern',
      );
    } else {
      const matchedToken = findTokenMatch(combined, codeExecTokens);
      if (matchedToken !== null) {
        addCap(
          Capability.EXECUTE_CODE,
          'combined',
          matchedToken,
          'name/description contains code execution keyword',
        );
      } else {
        const m =
          /\b(execute|run|evaluate|interpret)s?\s+(arbitrary\s+)?(python|javascript|typescript|node|js|ruby|code)\b/.exec(
            combined,
          ) ??
          /\b(python|javascript|node|js|ruby)\s+(code|script)\s+(execution|interpreter|repl)/.exec(
            combined,
          );
        if (m) {
          addCap(
            Capability.EXECUTE_CODE,
            'combined',
            m[0],
            'description indicates code execution in an interpreter or sandbox',
          );
        }
      }
    }
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
  {
    const matchedToken = findTokenMatch(combined, credentialTokens);
    if (matchedToken !== null) {
      addCap(
        Capability.READ_CREDENTIAL_HIGH,
        'combined',
        matchedToken,
        'name/description contains credential/secret term indicating high-sensitivity credential read',
      );
      addCap(
        Capability.READ_SECRET_HIGH,
        'combined',
        matchedToken,
        'name/description contains credential/secret term indicating high-sensitivity secret read',
      );
      // Keep legacy READ_SECRET in the output for back-compat consumers
      addCap(
        Capability.READ_SECRET,
        'combined',
        matchedToken,
        'legacy alias for READ_SECRET_HIGH; retained for backwards compatibility',
      );
    }
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
  {
    const matchedName = findMatch(name, sensitiveMediumPatterns);
    if (matchedName !== null) {
      addCap(
        Capability.READ_SENSITIVE_MEDIUM,
        'name',
        matchedName,
        'tool name matches org/team membership read pattern',
      );
    }
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
  {
    const matchedName = findMatch(name, lowMetadataPatterns);
    if (matchedName !== null) {
      addCap(
        Capability.READ_METADATA_LOW,
        'name',
        matchedName,
        'tool name matches public metadata read pattern (releases, tags, labels, branches)',
      );
    }
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
  {
    const matchedName = findMatch(name, mutateRepoPatterns);
    if (matchedName !== null) {
      addCap(
        Capability.MUTATE_REPOSITORY,
        'name',
        matchedName,
        'tool name matches repository mutation pattern',
      );
      addCap(
        Capability.MUTATE_REMOTE_STATE,
        'name',
        matchedName,
        'repository mutation implies remote state change',
      );
    }
  }

  // ---------- Issue / PR / Comment / Review mutation ----------
  const mutateIssuePrPatterns = [
    'create_issue',
    'issue_write',
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
  {
    const matchedName = findMatch(name, mutateIssuePrPatterns);
    if (matchedName !== null) {
      addCap(
        Capability.MUTATE_ISSUE_OR_PR,
        'name',
        matchedName,
        'tool name matches issue/PR mutation pattern',
      );
      addCap(
        Capability.MUTATE_REMOTE_STATE,
        'name',
        matchedName,
        'issue/PR mutation implies remote state change',
      );
    }
  }

  {
    const matchedName = findMatch(name, ['issue_read', 'pull_request_read']);
    if (matchedName !== null) {
      addCap(
        Capability.QUERY_REMOTE_SYSTEM,
        'name',
        matchedName,
        'tool reads issues/PRs implying remote system query',
      );
      addCap(
        Capability.READ_REMOTE_DATA,
        'name',
        matchedName,
        'tool reads issues/PRs implying remote data access',
      );
    }
  }

  // ---------- Untrusted content exposure ----------
  // Conservative: only classify tools that commonly surface attacker-controlled content
  // (issues/PRs/comments/discussions/external web fetch) as UNTRUSTED_CONTENT_EXPOSURE.
  const untrustedContentPatterns = [
    'dv_get_untrusted_prompt',
    'issue_read',
    'get_issue_comments',
    'list_issues',
    'search_issues',
    'pull_request_read',
    'get_pull_request_comments',
    'list_pull_requests',
    'search_pull_requests',
    'discussion',
    'discussions',
    'discussion_comment',
    'fetch',
    'fetch_url',
    'web_fetch',
    'http_get',
    'retrieve_url',
  ];
  {
    const matchedName = findMatch(name, untrustedContentPatterns);
    if (matchedName !== null) {
      addCap(
        Capability.UNTRUSTED_CONTENT_EXPOSURE,
        'name',
        matchedName,
        'tool name matches pattern that commonly surfaces attacker-controlled content',
      );
      addCap(
        Capability.INSTRUCTION_SOURCE,
        'name',
        matchedName,
        'tool can carry untrusted instructions into the agent context',
      );
    }
  }

  {
    const matchedName = findMatch(name, [
      'mutate_remote_state',
      'update_remote_state',
      'modify_remote_state',
    ]);
    if (matchedName !== null) {
      addCap(
        Capability.MUTATE_REMOTE_STATE,
        'name',
        matchedName,
        'tool name explicitly indicates remote state mutation',
      );
    }
  }

  // ---------- Generic remote-mutation hints ----------
  // Any *_write/_update/_create/_delete on a remote SaaS context that we haven't classified yet
  if (
    remoteSaas &&
    !caps.has(Capability.MUTATE_REPOSITORY) &&
    !caps.has(Capability.MUTATE_ISSUE_OR_PR) &&
    !caps.has(Capability.MUTATE_REMOTE_STATE)
  ) {
    const m = /(^|_)(write|update|create|delete|merge|patch|publish)(_|$)/.exec(name);
    if (m) {
      addCap(
        Capability.MUTATE_REMOTE_STATE,
        'combined',
        m[0],
        'SaaS context with mutation verb in tool name implies remote state mutation',
      );
    }
  }

  // ---------- Query / search remote system ----------
  // search_*, list_*, get_* on remote SaaS → query+read remote data, NOT execute.
  if (remoteSaas) {
    const m = /(^|_)(search|list|get)(_|$)/.exec(name);
    if (m) {
      addCap(
        Capability.QUERY_REMOTE_SYSTEM,
        'combined',
        m[0],
        'SaaS context with search/list/get verb in tool name implies remote system query',
      );
      addCap(
        Capability.READ_REMOTE_DATA,
        'combined',
        m[0],
        'SaaS context with search/list/get verb in tool name implies remote data access',
      );
    }
  }
  // Even outside known SaaS, search_* implies remote query
  const knownLocalSearchPatterns = ['search_files', 'search_directory'];
  if (
    /^(search|query)_/.test(name) &&
    !matchesAny(name, knownLocalSearchPatterns) &&
    !caps.has(Capability.QUERY_DATABASE) &&
    !caps.has(Capability.READ_LOCAL_FILE) &&
    !caps.has(Capability.READ_METADATA_LOW)
  ) {
    addCap(
      Capability.QUERY_REMOTE_SYSTEM,
      'name',
      name,
      'search/query prefix on tool name implies remote system query',
    );
    addCap(
      Capability.READ_REMOTE_DATA,
      'name',
      name,
      'search/query prefix on tool name implies remote data access',
    );
  }

  // ---------- File reads ----------
  // Distinguish local file read vs remote file content read.
  const localFileNamePatterns = [
    'read_file',
    'read_text_file',
    'read_media_file',
    'read_multiple_files',
    ...knownLocalSearchPatterns,
    'list_directory',
    'directory_tree',
    'get_file_info',
    'list_allowed_directories',
    'open_file',
    'cat_file',
    'read_local',
  ];
  const localFileTokens = ['filesystem', 'file system', 'local file', 'local disk'];
  {
    const matchedLocalName = findMatch(name, localFileNamePatterns);
    const matchedLocalToken = matchedLocalName === null ? findTokenMatch(combined, localFileTokens) : null;
    const isLocalFileRead = matchedLocalName !== null || matchedLocalToken !== null;
    if (isLocalFileRead && !remoteSaas) {
      const src = matchedLocalName !== null ? 'name' : 'combined';
      const matched = (matchedLocalName ?? matchedLocalToken)!;
      addCap(
        Capability.READ_LOCAL_FILE,
        src as ClassificationEvidence['source'],
        matched,
        src === 'name'
          ? 'tool name matches local file read pattern'
          : 'name/description indicates local filesystem access',
      );
    }
  }

  // get_file_contents from remote SaaS → READ_REMOTE_DATA, not local file
  if (
    /get_file_contents?$/.test(name) ||
    /get_file_content$/.test(name) ||
    /^get_content$/.test(name)
  ) {
    if (remoteSaas) {
      addCap(
        Capability.READ_REMOTE_DATA,
        'name',
        name,
        'get_file_contents in SaaS context indicates remote repository file read',
      );
    } else {
      addCap(
        Capability.READ_LOCAL_FILE,
        'name',
        name,
        'get_file_contents without SaaS context indicates local file read',
      );
    }
  }

  // ---------- File writes ----------
  {
    const fileWritePatterns = [
      'write_file',
      'edit_file',
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
      'create_directory',
      'rmdir',
    ];
    const matchedName = findMatch(name, fileWritePatterns);
    if (matchedName !== null && !remoteSaas) {
      addCap(
        Capability.WRITE_LOCAL_FILE,
        'name',
        matchedName,
        'tool name matches local file write pattern',
      );
    }
  }

  // ---------- HTTP / network ----------
  {
    const httpNamePatterns = [
      'dv_send_external',
      'http_request',
      'send_request',
      'web_request',
      'webhook',
      'fetch_url',
      'curl',
    ];
    const httpTokens = ['http', 'https', 'fetch', 'webhook'];
    const matchedName = findMatch(name, httpNamePatterns);
    if (matchedName !== null) {
      addCap(
        Capability.SEND_HTTP,
        'name',
        matchedName,
        'tool name matches HTTP/network request pattern',
      );
    } else {
      const matchedToken = findTokenMatch(combined, httpTokens);
      if (matchedToken !== null) {
        addCap(
          Capability.SEND_HTTP,
          'combined',
          matchedToken,
          'name/description contains HTTP/network keyword',
        );
      }
    }
  }

  // SEND_EXTERNAL: explicit external send (webhooks, email, generic outbound HTTP that crosses
  // a trust boundary). For now we infer it whenever SEND_HTTP is present and there's no clear
  // indication the destination is internal-only.
  if (caps.has(Capability.SEND_HTTP)) {
    addCap(
      Capability.SEND_EXTERNAL,
      'derived',
      'SEND_HTTP',
      'SEND_EXTERNAL inferred from SEND_HTTP; outbound HTTP requests cross trust boundary by default',
    );
  }

  // ---------- Email ----------
  {
    const emailNamePatterns = ['send_email', 'send_mail'];
    const emailTokens = ['smtp', 'sendgrid', 'mailgun'];
    const matchedName = findMatch(name, emailNamePatterns);
    if (matchedName !== null) {
      addCap(
        Capability.SEND_EMAIL,
        'name',
        matchedName,
        'tool name matches email send pattern',
      );
      addCap(
        Capability.SEND_EXTERNAL,
        'name',
        matchedName,
        'email send implies external communication',
      );
    } else {
      const matchedToken = findTokenMatch(combined, emailTokens);
      if (matchedToken !== null) {
        addCap(
          Capability.SEND_EMAIL,
          'combined',
          matchedToken,
          'name/description contains email provider keyword',
        );
        addCap(
          Capability.SEND_EXTERNAL,
          'combined',
          matchedToken,
          'email provider keyword implies external communication',
        );
      }
    }
  }

  // ---------- Database ----------
  {
    const dbNamePatterns = ['query_database', 'db_query', 'run_query', 'sql_query'];
    const dbTokens = ['sqlite', 'postgres', 'mysql', 'mongodb', 'sql'];
    const matchedName = findMatch(name, dbNamePatterns);
    if (matchedName !== null) {
      addCap(
        Capability.QUERY_DATABASE,
        'name',
        matchedName,
        'tool name matches database query pattern',
      );
    } else {
      const matchedToken = findTokenMatch(combined, dbTokens);
      if (matchedToken !== null) {
        addCap(
          Capability.QUERY_DATABASE,
          'combined',
          matchedToken,
          'name/description contains database system keyword',
        );
      }
    }
  }

  // ---------- Identity / IAM ----------
  {
    const iamNamePatterns = [
      'assume_role',
      'create_user',
      'delete_user',
      'add_user',
      'manage_user',
      'create_role',
      'attach_policy',
      'detach_policy',
    ];
    const iamTokens = ['iam', 'rbac', 'acl'];
    const matchedName = findMatch(name, iamNamePatterns);
    if (matchedName !== null) {
      addCap(
        Capability.MUTATE_IDENTITY,
        'name',
        matchedName,
        'tool name matches identity/IAM mutation pattern',
      );
    } else {
      const matchedToken = findTokenMatch(combined, iamTokens);
      if (matchedToken !== null) {
        addCap(
          Capability.MUTATE_IDENTITY,
          'combined',
          matchedToken,
          'name/description contains IAM/access control keyword',
        );
      }
    }
  }

  // ---------- Cloud resources ----------
  {
    const cloudTokens = [
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
    ];
    const matchedToken = findTokenMatch(combined, cloudTokens);
    if (matchedToken !== null) {
      addCap(
        Capability.MUTATE_CLOUD_RESOURCE,
        'combined',
        matchedToken,
        'name/description contains cloud provider keyword',
      );
    }
  }

  // ---------- Export / data exfil ----------
  {
    const exportPatterns = ['export_all', 'bulk_export', 'data_export', 'dump_all', 'backup_all'];
    const matchedName = findMatch(name, exportPatterns);
    if (matchedName !== null) {
      addCap(
        Capability.EXPORT_DATA,
        'name',
        matchedName,
        'tool name matches bulk data export pattern',
      );
    }
  }

  // ---------- Schema parameter hints ----------
  {
    const matchedPathParam = params.find(
      (p) => p === 'path' || p === 'filepath' || p === 'file_path' || p === 'filename',
    );
    if (
      matchedPathParam !== undefined &&
      !remoteSaas &&
      !caps.has(Capability.WRITE_LOCAL_FILE) &&
      !caps.has(Capability.READ_REMOTE_DATA)
    ) {
      addCap(
        Capability.READ_LOCAL_FILE,
        'schema',
        matchedPathParam,
        'schema has path parameter suggesting local filesystem access',
      );
    }

    const matchedUrlParam = params.find(
      (p) => p === 'url' || p === 'endpoint' || p === 'uri' || p === 'base_url',
    );
    if (matchedUrlParam !== undefined) {
      if (!caps.has(Capability.SEND_HTTP)) {
        addCap(
          Capability.READ_REMOTE_DATA,
          'schema',
          matchedUrlParam,
          'schema has URL parameter suggesting remote data access',
        );
      } else if (matchesAny(combined, ['fetch', 'get', 'read', 'retrieve', 'load', 'download'])) {
        addCap(
          Capability.READ_REMOTE_DATA,
          'schema',
          matchedUrlParam,
          'schema has URL parameter with fetch/read context suggesting remote data read',
        );
      }
    }

    const matchedSqlParam = params.find((p) => p === 'query' || p === 'sql');
    if (matchedSqlParam !== undefined && /sql|database|db/.test(combined)) {
      addCap(
        Capability.QUERY_DATABASE,
        'schema',
        matchedSqlParam,
        'schema has query/SQL parameter in database context',
      );
    }

    const matchedCommandParam = params.find(
      (p) => p === 'command' || p === 'cmd' || p === 'shell',
    );
    if (matchedCommandParam !== undefined) {
      addCap(
        Capability.RUN_SHELL,
        'schema',
        matchedCommandParam,
        'schema has command parameter suggesting shell execution',
      );
    }
  }

  // ---------- Fallback ----------
  if (caps.size === 0) {
    addCap(
      Capability.UNKNOWN,
      'combined',
      name,
      'no classification pattern matched; capability unknown',
    );
  }

  const capsArray = Array.from(caps);
  const baseScore = Math.max(...capsArray.map((c) => CAPABILITY_SCORES[c] ?? 10));

  // Bonus for multiple dangerous capabilities (>=55 score)
  const dangerousCaps = capsArray.filter((c) => (CAPABILITY_SCORES[c] ?? 0) >= 55).length;
  const bonus = dangerousCaps > 1 ? Math.min(dangerousCaps * 5, 10) : 0;

  const instructionUserGeneratedPatterns = [
    'issue_read',
    'list_issues',
    'search_issues',
    'pull_request_read',
    'get_issue_comments',
    'list_pull_requests',
    'search_pull_requests',
    'discussion',
    'discussion_comment',
  ];
  const instructionFetchPatterns = ['fetch', 'fetch_url', 'web_fetch', 'http_get', 'retrieve_url'];
  const isInstructionFromUserGenerated = matchesAny(name, instructionUserGeneratedPatterns);
  const isInstructionFromFetch = matchesAny(name, instructionFetchPatterns);
  const isInstructionCapable =
    isInstructionFromUserGenerated ||
    isInstructionFromFetch ||
    caps.has(Capability.UNTRUSTED_CONTENT_EXPOSURE);
  const isUntrusted = isInstructionCapable;

  const hasReadLikeCapability =
    caps.has(Capability.READ_LOCAL_FILE) ||
    caps.has(Capability.READ_REMOTE_DATA) ||
    caps.has(Capability.READ_CREDENTIAL_HIGH) ||
    caps.has(Capability.READ_SECRET_HIGH) ||
    caps.has(Capability.READ_SECRET) ||
    caps.has(Capability.READ_SENSITIVE_MEDIUM) ||
    caps.has(Capability.READ_METADATA_LOW) ||
    caps.has(Capability.QUERY_DATABASE) ||
    caps.has(Capability.QUERY_REMOTE_SYSTEM);
  const sourceRoleSet = new Set<SourceRole>();
  if (hasReadLikeCapability || isInstructionCapable) sourceRoleSet.add(SourceRole.DATA_SOURCE);
  if (isInstructionCapable) sourceRoleSet.add(SourceRole.INSTRUCTION_SOURCE);

  let contentOrigin: ContentOrigin = ContentOrigin.LOCAL;
  if (isInstructionFromUserGenerated) {
    contentOrigin = ContentOrigin.USER_GENERATED;
  } else if (isInstructionFromFetch) {
    contentOrigin = ContentOrigin.REMOTE;
  } else if (caps.has(Capability.QUERY_DATABASE)) {
    contentOrigin = ContentOrigin.DB_ROW;
  } else if (remoteSaas) {
    contentOrigin = ContentOrigin.EXTERNAL_SAAS;
  } else if (caps.has(Capability.READ_REMOTE_DATA) || caps.has(Capability.QUERY_REMOTE_SYSTEM)) {
    contentOrigin = ContentOrigin.REMOTE;
  }

  return {
    capabilities: capsArray,
    riskScore: Math.min(baseScore + bonus, 100),
    sourceRole: Array.from(sourceRoleSet),
    isUntrusted,
    isInstructionCapable,
    contentOrigin,
    evidence: evidenceList,
  };
}
