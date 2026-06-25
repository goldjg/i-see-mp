export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  server_count INTEGER NOT NULL DEFAULT 0,
  tool_count INTEGER NOT NULL DEFAULT 0,
  resource_count INTEGER NOT NULL DEFAULT 0,
  prompt_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  error TEXT
);

CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id),
  name TEXT NOT NULL,
  url TEXT,
  command TEXT,
  args TEXT,
  env TEXT,
  transport TEXT NOT NULL,
  is_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tools (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id),
  server_id TEXT NOT NULL REFERENCES servers(id),
  name TEXT NOT NULL,
  description TEXT,
  input_schema TEXT,
  capabilities TEXT NOT NULL DEFAULT '[]',
  source_role TEXT NOT NULL DEFAULT '[]',
  is_untrusted INTEGER NOT NULL DEFAULT 0,
  is_instruction_capable INTEGER NOT NULL DEFAULT 0,
  content_origin TEXT NOT NULL DEFAULT 'local',
  trust_zone TEXT,
  risk_score INTEGER NOT NULL DEFAULT 0,
  classification_evidence TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id),
  server_id TEXT NOT NULL REFERENCES servers(id),
  uri TEXT NOT NULL,
  name TEXT,
  description TEXT,
  mime_type TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id),
  server_id TEXT NOT NULL REFERENCES servers(id),
  name TEXT NOT NULL,
  description TEXT,
  arguments TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id),
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  server_id TEXT,
  capabilities TEXT NOT NULL DEFAULT '[]',
  risk_score INTEGER NOT NULL DEFAULT 0,
  trust_zone TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id),
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  type TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id),
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  affected_node_ids TEXT NOT NULL DEFAULT '[]',
  affected_edge_ids TEXT,
  remediation_hint TEXT,
  created_at TEXT NOT NULL,
  confidence TEXT,
  static_possible INTEGER,
  observed INTEGER,
  tested INTEGER,
  path_status TEXT,
  test_run_ids TEXT,
  candidate_path_id TEXT,
  path_summary TEXT,
  source_capabilities TEXT,
  sink_capabilities TEXT,
  boundary_crossed TEXT,
  is_cross_server INTEGER,
  source_server_id TEXT,
  sink_server_id TEXT,
  crosses_trust_boundary INTEGER NOT NULL DEFAULT 0,
  trust_transition TEXT,
  explanation TEXT,
  evidence TEXT,
  lethal_trifecta_status TEXT,
  sub_category TEXT,
  injection_confirmed INTEGER NOT NULL DEFAULT 0,
  trust_boundary_confirmed INTEGER NOT NULL DEFAULT 0,
  trust_boundary_exploit_confirmed INTEGER NOT NULL DEFAULT 0,
  baseline_plan TEXT
);

-- Test-run model (deterministic path testing).
-- A test_run captures one execution of a deterministic plan against a target server/finding.
CREATE TABLE IF NOT EXISTS test_runs (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id),
  profile TEXT NOT NULL,
  test_case_id TEXT NOT NULL,
  test_case_name TEXT NOT NULL,
  finding_id TEXT,
  candidate_path_id TEXT,
  server_id TEXT,
  source_tool_id TEXT,
  sink_tool_id TEXT,
  outcome TEXT,
  path_summary TEXT,
  plan TEXT NOT NULL,
  tool_calls TEXT NOT NULL DEFAULT '[]',
  baseline_tool_calls TEXT,
  injected_tool_calls TEXT,
  deviation_detected INTEGER NOT NULL DEFAULT 0,
  deviation_score INTEGER,
  injection_confirmed INTEGER NOT NULL DEFAULT 0,
  injection_chain TEXT,
  trust_boundary_exploit_confirmed INTEGER NOT NULL DEFAULT 0,
  canary_expected TEXT,
  canary_observed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  path_status TEXT NOT NULL DEFAULT 'static_possible',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  test_run_id TEXT NOT NULL REFERENCES test_runs(id),
  candidate_path_id TEXT,
  type TEXT NOT NULL,
  step_index INTEGER,
  tool_name TEXT,
  redacted_input TEXT,
  redacted_output TEXT,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS logs (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  level TEXT NOT NULL,
  phase TEXT NOT NULL,
  collection_id TEXT,
  server_id TEXT,
  tool_id TEXT,
  finding_id TEXT,
  test_run_id TEXT,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json TEXT,
  redacted INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_logs_collection_id ON logs(collection_id);
CREATE INDEX IF NOT EXISTS idx_logs_finding_id ON logs(finding_id);
CREATE INDEX IF NOT EXISTS idx_logs_test_run_id ON logs(test_run_id);
CREATE INDEX IF NOT EXISTS idx_logs_phase ON logs(phase);
`;
