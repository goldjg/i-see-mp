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
  risk_score INTEGER NOT NULL DEFAULT 0,
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
  path_summary TEXT,
  source_capabilities TEXT,
  sink_capabilities TEXT,
  boundary_crossed TEXT,
  explanation TEXT,
  evidence TEXT
);

-- Reserved for post-MVP tester (unused in MVP)
CREATE TABLE IF NOT EXISTS test_runs (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id),
  tool_id TEXT NOT NULL REFERENCES tools(id),
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TEXT,
  completed_at TEXT,
  result TEXT,
  evidence TEXT
);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  test_run_id TEXT NOT NULL REFERENCES test_runs(id),
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;
