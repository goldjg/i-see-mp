import { Capability } from '@mcphound/core';
import type { McpTool } from '@mcphound/core';

export interface ClassificationResult {
  capabilities: Capability[];
  riskScore: number;
}

const CAPABILITY_SCORES: Record<Capability, number> = {
  [Capability.RUN_SHELL]: 90,
  [Capability.EXECUTE_CODE]: 85,
  [Capability.READ_SECRET]: 80,
  [Capability.MUTATE_IDENTITY]: 80,
  [Capability.MUTATE_CLOUD_RESOURCE]: 75,
  [Capability.EXPORT_DATA]: 70,
  [Capability.SEND_HTTP]: 60,
  [Capability.WRITE_LOCAL_FILE]: 55,
  [Capability.WRITE_REMOTE_DATA]: 55,
  [Capability.QUERY_DATABASE]: 50,
  [Capability.CREATE_TICKET]: 40,
  [Capability.READ_REMOTE_DATA]: 35,
  [Capability.READ_LOCAL_FILE]: 30,
  [Capability.SEND_EMAIL]: 65,
  [Capability.UNKNOWN]: 10,
};

function matchesAny(text: string, patterns: string[]): boolean {
  const lower = text.toLowerCase();
  return patterns.some((p) => lower.includes(p));
}

function getSchemaParams(tool: McpTool): string[] {
  const schema = tool.inputSchema;
  if (!schema || typeof schema !== 'object') return [];
  const props = (schema as Record<string, unknown>)['properties'];
  if (!props || typeof props !== 'object') return [];
  return Object.keys(props as Record<string, unknown>).map((k) => k.toLowerCase());
}

export function classifyTool(tool: McpTool): ClassificationResult {
  const caps = new Set<Capability>();
  const name = tool.name.toLowerCase();
  const desc = (tool.description ?? '').toLowerCase();
  const combined = `${name} ${desc}`;
  const params = getSchemaParams(tool);

  // Shell / code execution
  if (matchesAny(combined, ['shell', 'exec', 'execute', 'bash', 'cmd', 'run_command', 'run_shell', 'terminal', 'subprocess', 'spawn'])) {
    caps.add(Capability.RUN_SHELL);
    caps.add(Capability.EXECUTE_CODE);
  }
  if (matchesAny(combined, ['execute_code', 'eval', 'repl', 'interpreter', 'script', 'python', 'node', 'javascript', 'typescript'])) {
    caps.add(Capability.EXECUTE_CODE);
  }

  // File operations
  if (matchesAny(combined, ['read_file', 'get_file', 'open_file', 'read_content', 'file_content', 'cat ', 'cat_file'])) {
    caps.add(Capability.READ_LOCAL_FILE);
  }
  if (matchesAny(combined, ['write_file', 'save_file', 'create_file', 'put_file', 'update_file', 'append_file', 'delete_file', 'remove_file', 'rename_file', 'move_file', 'copy_file', 'mkdir', 'rmdir'])) {
    caps.add(Capability.WRITE_LOCAL_FILE);
  }
  if (matchesAny(combined, ['filesystem', 'fs ', ' fs_', 'file system']) && !caps.has(Capability.READ_LOCAL_FILE)) {
    caps.add(Capability.READ_LOCAL_FILE);
  }

  // HTTP / network
  if (matchesAny(combined, ['http', 'https', 'fetch', 'request', 'curl', 'download', 'upload', 'webhook', 'api_call', 'send_request', 'http_request', 'web_request'])) {
    caps.add(Capability.SEND_HTTP);
  }
  if (matchesAny(combined, ['download', 'scrape', 'crawl', 'browse', 'remote_data', 'read_url', 'get_url'])) {
    caps.add(Capability.READ_REMOTE_DATA);
  }

  // Email
  if (matchesAny(combined, ['email', 'smtp', 'mail', 'send_email', 'send_mail', 'mailgun', 'sendgrid'])) {
    caps.add(Capability.SEND_EMAIL);
  }

  // Database
  if (matchesAny(combined, ['database', 'sql', 'query_db', 'sqlite', 'postgres', 'mysql', 'mongodb', 'query_database', 'db_query', 'run_query'])) {
    caps.add(Capability.QUERY_DATABASE);
  }

  // Secrets / credentials
  if (matchesAny(combined, ['secret', 'password', 'token', 'credential', 'api_key', 'apikey', 'private_key', 'access_key', 'auth_token', 'get_secret', 'read_secret', 'vault'])) {
    caps.add(Capability.READ_SECRET);
  }

  // Identity / IAM
  if (matchesAny(combined, ['iam', 'role', 'policy', 'identity', 'permission', 'access_control', 'rbac', 'acl', 'assume_role', 'create_user', 'delete_user', 'add_user', 'manage_user'])) {
    caps.add(Capability.MUTATE_IDENTITY);
  }

  // Cloud resources
  if (matchesAny(combined, ['aws', 'azure', 'gcp', 'cloud', 's3', 'bucket', 'ec2', 'lambda', 'cloudformation', 'terraform', 'kubernetes', 'k8s', 'container', 'blob', 'storage_bucket'])) {
    caps.add(Capability.MUTATE_CLOUD_RESOURCE);
  }

  // Export / data exfil
  if (matchesAny(combined, ['export', 'exfil', 'dump', 'backup', 'extract', 'download_all', 'bulk_export', 'data_export'])) {
    caps.add(Capability.EXPORT_DATA);
  }

  // Tickets / issues
  if (matchesAny(combined, ['create_issue', 'create_ticket', 'jira', 'github', 'gitlab', 'pull_request', 'create_pr', 'issue', 'linear', 'trello', 'asana'])) {
    caps.add(Capability.CREATE_TICKET);
  }

  // Schema parameter hints
  if (params.includes('path') || params.includes('filepath') || params.includes('file_path') || params.includes('filename')) {
    if (!caps.has(Capability.WRITE_LOCAL_FILE)) {
      caps.add(Capability.READ_LOCAL_FILE);
    }
  }
  if (params.some((p) => p === 'url' || p === 'endpoint' || p === 'uri' || p === 'base_url')) {
    if (!caps.has(Capability.SEND_HTTP)) {
      caps.add(Capability.READ_REMOTE_DATA);
    } else if (matchesAny(combined, ['fetch', 'get', 'read', 'retrieve', 'load', 'download'])) {
      caps.add(Capability.READ_REMOTE_DATA);
    }
  }
  if (params.some((p) => p === 'query' || p === 'sql')) {
    if (!caps.has(Capability.QUERY_DATABASE)) {
      caps.add(Capability.QUERY_DATABASE);
    }
  }
  if (params.some((p) => p === 'command' || p === 'cmd' || p === 'shell')) {
    caps.add(Capability.RUN_SHELL);
  }

  if (caps.size === 0) {
    caps.add(Capability.UNKNOWN);
  }

  const capsArray = Array.from(caps);
  const baseScore = Math.max(...capsArray.map((c) => CAPABILITY_SCORES[c] ?? 10));

  // Bonus for multiple dangerous capabilities
  const dangerousCaps = capsArray.filter(
    (c) => (CAPABILITY_SCORES[c] ?? 0) >= 55,
  ).length;
  const bonus = dangerousCaps > 1 ? Math.min(dangerousCaps * 5, 10) : 0;

  return {
    capabilities: capsArray,
    riskScore: Math.min(baseScore + bonus, 100),
  };
}
