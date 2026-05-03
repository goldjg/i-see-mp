export const NodeType = {
  AGENT: 'agent',
  MCP_SERVER: 'mcp_server',
  TOOL: 'tool',
  RESOURCE: 'resource',
  PROMPT: 'prompt',
  DATA_SOURCE: 'data_source',
  INSTRUCTION_SOURCE: 'instruction_source',
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
  CARRIES_INSTRUCTION: 'carries_instruction',
  INFLUENCES: 'influences',
  INFLUENCED_BY: 'influenced_by',
  CROSSES_BOUNDARY: 'crosses_boundary',
  // Reserved for post-MVP tester — do not use in MVP
  OBSERVED_CALL: 'observed_call',
  TESTED_PATH: 'tested_path',
} as const;
export type EdgeType = (typeof EdgeType)[keyof typeof EdgeType];

export const SourceRole = {
  DATA_SOURCE: 'DATA_SOURCE',
  INSTRUCTION_SOURCE: 'INSTRUCTION_SOURCE',
} as const;
export type SourceRole = (typeof SourceRole)[keyof typeof SourceRole];

export const ContentOrigin = {
  LOCAL: 'local',
  REMOTE: 'remote',
  USER_GENERATED: 'user_generated',
  EXTERNAL_SAAS: 'external_saas',
  DB_ROW: 'db_row',
} as const;
export type ContentOrigin = (typeof ContentOrigin)[keyof typeof ContentOrigin];

export const Capability = {
  // Read / data access
  READ_LOCAL_FILE: 'READ_LOCAL_FILE',
  READ_REMOTE_DATA: 'READ_REMOTE_DATA',
  // Sensitivity tiers (preferred over legacy READ_SECRET)
  READ_CREDENTIAL_HIGH: 'READ_CREDENTIAL_HIGH',
  READ_SECRET_HIGH: 'READ_SECRET_HIGH',
  READ_SENSITIVE_MEDIUM: 'READ_SENSITIVE_MEDIUM',
  READ_METADATA_LOW: 'READ_METADATA_LOW',
  /** @deprecated kept for backwards compatibility — use READ_SECRET_HIGH / READ_CREDENTIAL_HIGH */
  READ_SECRET: 'READ_SECRET',
  // Write / mutation
  WRITE_LOCAL_FILE: 'WRITE_LOCAL_FILE',
  WRITE_REMOTE_DATA: 'WRITE_REMOTE_DATA',
  MUTATE_REMOTE_STATE: 'MUTATE_REMOTE_STATE',
  MUTATE_REPOSITORY: 'MUTATE_REPOSITORY',
  MUTATE_ISSUE_OR_PR: 'MUTATE_ISSUE_OR_PR',
  // Execution
  EXECUTE_CODE: 'EXECUTE_CODE',
  RUN_SHELL: 'RUN_SHELL',
  // Network / send
  SEND_HTTP: 'SEND_HTTP',
  SEND_EXTERNAL: 'SEND_EXTERNAL',
  SEND_EMAIL: 'SEND_EMAIL',
  // Query
  QUERY_REMOTE_SYSTEM: 'QUERY_REMOTE_SYSTEM',
  QUERY_DATABASE: 'QUERY_DATABASE',
  UNTRUSTED_CONTENT_EXPOSURE: 'UNTRUSTED_CONTENT_EXPOSURE',
  // Misc
  CREATE_TICKET: 'CREATE_TICKET',
  MUTATE_IDENTITY: 'MUTATE_IDENTITY',
  MUTATE_CLOUD_RESOURCE: 'MUTATE_CLOUD_RESOURCE',
  EXPORT_DATA: 'EXPORT_DATA',
  UNKNOWN: 'UNKNOWN',
} as const;
export type Capability = (typeof Capability)[keyof typeof Capability];

export const LethalTrifectaStatus = {
  NONE: 'NONE',
  POSSIBLE: 'POSSIBLE',
  CONFIRMED: 'CONFIRMED',
  /** @deprecated compatibility alias for POSSIBLE */
  CANDIDATE: 'POSSIBLE',
  /** @deprecated compatibility alias for CONFIRMED */
  COMPLETE: 'CONFIRMED',
} as const;
export type LethalTrifectaStatus = (typeof LethalTrifectaStatus)[keyof typeof LethalTrifectaStatus];

export const TrustBoundary = {
  LOCAL: 'LOCAL',
  INTERNAL: 'INTERNAL',
  EXTERNAL: 'EXTERNAL',
  SAAS: 'SAAS',
  UNKNOWN: 'UNKNOWN',
} as const;
export type TrustBoundary = (typeof TrustBoundary)[keyof typeof TrustBoundary];

export const Confidence = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
} as const;
export type Confidence = (typeof Confidence)[keyof typeof Confidence];

export const PathStatus = {
  STATIC_POSSIBLE: 'static_possible',
  TESTED_CONFIRMED: 'tested_confirmed',
  TESTED_REJECTED: 'tested_rejected',
  TESTED_INCONCLUSIVE: 'tested_inconclusive',
} as const;
export type PathStatus = (typeof PathStatus)[keyof typeof PathStatus];

export const TestProfile = {
  SAFE: 'safe',
  DEMO_CONFIRM: 'demo-confirm',
  GITHUB_SAFE_CANARY: 'github-safe-canary',
  PROMPT_INJECTION_GITHUB: 'prompt-injection-github',
  PROMPT_INJECTION_FETCH: 'prompt-injection-fetch',
  PROMPT_INJECTION_DB: 'prompt-injection-db',
} as const;
export type TestProfile = (typeof TestProfile)[keyof typeof TestProfile];

export const TestStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  CONFIRMED: 'confirmed',
  REJECTED: 'rejected',
  INCONCLUSIVE: 'inconclusive',
  ERROR: 'error',
} as const;
export type TestStatus = (typeof TestStatus)[keyof typeof TestStatus];

export const TestOutcome = {
  TESTED_CONFIRMED: 'TESTED_CONFIRMED',
  TESTED_REJECTED: 'TESTED_REJECTED',
  TESTED_INCONCLUSIVE: 'TESTED_INCONCLUSIVE',
  TEST_SKIPPED: 'TEST_SKIPPED',
  TEST_ERROR: 'TEST_ERROR',
} as const;
export type TestOutcome = (typeof TestOutcome)[keyof typeof TestOutcome];

export const RiskCategory = {
  DATA_EXFILTRATION: 'DATA_EXFILTRATION',
  PRIVILEGED_MUTATION: 'PRIVILEGED_MUTATION',
  CODE_EXECUTION: 'CODE_EXECUTION',
  TRUST_BOUNDARY_CROSSING: 'TRUST_BOUNDARY_CROSSING',
  UNTRUSTED_CONTEXT_INFLUENCE: 'UNTRUSTED_CONTEXT_INFLUENCE',
  SENSITIVE_DATA_EXPOSURE: 'SENSITIVE_DATA_EXPOSURE',
  PROMPT_INJECTION: 'PROMPT_INJECTION',
  UNVERIFIED_SERVER: 'UNVERIFIED_SERVER',
  OVERBROAD_TOOL: 'OVERBROAD_TOOL',
  DANGEROUS_TOOL_CHAIN: 'DANGEROUS_TOOL_CHAIN',
} as const;
export type RiskCategory = (typeof RiskCategory)[keyof typeof RiskCategory];

export const TrifectaStage = {
  COMPLETE: 'COMPLETE',
  PARTIAL: 'PARTIAL',
  CAPABILITY_ONLY: 'CAPABILITY_ONLY',
} as const;
export type TrifectaStage = (typeof TrifectaStage)[keyof typeof TrifectaStage];

export const DataflowClassification = {
  COMPLETE: 'COMPLETE',
  PARTIAL: 'PARTIAL',
  NONE: 'NONE',
} as const;
export type DataflowClassification =
  (typeof DataflowClassification)[keyof typeof DataflowClassification];
