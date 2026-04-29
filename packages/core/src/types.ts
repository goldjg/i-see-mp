export const NodeType = {
  AGENT: 'agent',
  MCP_SERVER: 'mcp_server',
  TOOL: 'tool',
  RESOURCE: 'resource',
  PROMPT: 'prompt',
  DATA_SOURCE: 'data_source',
  EXTERNAL_SYSTEM: 'external_system',
  TRUST_BOUNDARY: 'trust_boundary',
  SENSITIVE_DATA: 'sensitive_data',
  CONTEXT_SOURCE: 'context_source',
} as const;
export type NodeType = (typeof NodeType)[keyof typeof NodeType];

export const EdgeType = {
  EXPOSES: 'exposes',
  CAN_CALL: 'can_call',
  CAN_READ: 'can_read',
  CAN_WRITE: 'can_write',
  CAN_EXECUTE: 'can_execute',
  CAN_SEND_TO: 'can_send_to',
  RETURNS_TO_CONTEXT: 'returns_to_context',
  INFLUENCES: 'influences',
  CROSSES_BOUNDARY: 'crosses_boundary',
  // Reserved for post-MVP tester — do not use in MVP
  OBSERVED_CALL: 'observed_call',
  TESTED_PATH: 'tested_path',
} as const;
export type EdgeType = (typeof EdgeType)[keyof typeof EdgeType];

export const Capability = {
  READ_LOCAL_FILE: 'READ_LOCAL_FILE',
  READ_REMOTE_DATA: 'READ_REMOTE_DATA',
  READ_SECRET: 'READ_SECRET',
  WRITE_LOCAL_FILE: 'WRITE_LOCAL_FILE',
  WRITE_REMOTE_DATA: 'WRITE_REMOTE_DATA',
  EXECUTE_CODE: 'EXECUTE_CODE',
  RUN_SHELL: 'RUN_SHELL',
  SEND_HTTP: 'SEND_HTTP',
  SEND_EMAIL: 'SEND_EMAIL',
  CREATE_TICKET: 'CREATE_TICKET',
  MUTATE_IDENTITY: 'MUTATE_IDENTITY',
  MUTATE_CLOUD_RESOURCE: 'MUTATE_CLOUD_RESOURCE',
  QUERY_DATABASE: 'QUERY_DATABASE',
  EXPORT_DATA: 'EXPORT_DATA',
  UNKNOWN: 'UNKNOWN',
} as const;
export type Capability = (typeof Capability)[keyof typeof Capability];

export const RiskCategory = {
  DATA_EXFILTRATION: 'DATA_EXFILTRATION',
  PRIVILEGED_MUTATION: 'PRIVILEGED_MUTATION',
  CODE_EXECUTION: 'CODE_EXECUTION',
  TRUST_BOUNDARY_CROSSING: 'TRUST_BOUNDARY_CROSSING',
  UNTRUSTED_CONTEXT_INFLUENCE: 'UNTRUSTED_CONTEXT_INFLUENCE',
  SENSITIVE_DATA_EXPOSURE: 'SENSITIVE_DATA_EXPOSURE',
  UNVERIFIED_SERVER: 'UNVERIFIED_SERVER',
  OVERBROAD_TOOL: 'OVERBROAD_TOOL',
  DANGEROUS_TOOL_CHAIN: 'DANGEROUS_TOOL_CHAIN',
} as const;
export type RiskCategory = (typeof RiskCategory)[keyof typeof RiskCategory];
