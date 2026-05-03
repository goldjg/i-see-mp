import type Database from 'better-sqlite3';
import type { Finding, Capability, TrustBoundary, Confidence, PathStatus } from '@iseemp/core';

export interface FindingRow {
  id: string;
  collection_id: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  affected_node_ids: string; // JSON
  remediation_hint: string | null;
  created_at: string;
  // New columns — optional for backwards-compat with older callers/tests
  affected_edge_ids?: string | null; // JSON
  confidence?: string | null;
  static_possible?: number | null;
  observed?: number | null;
  tested?: number | null;
  path_status?: string | null;
  test_run_ids?: string | null; // JSON
  candidate_path_id?: string | null;
  path_summary?: string | null;
  source_capabilities?: string | null; // JSON
  sink_capabilities?: string | null; // JSON
  boundary_crossed?: string | null;
  is_cross_server?: number | null;
  source_server_id?: string | null;
  sink_server_id?: string | null;
  crosses_trust_boundary?: number | null;
  trust_transition?: string | null;
  explanation?: string | null;
  evidence?: string | null; // JSON
  lethal_trifecta_status?: string | null;
}

const COLUMNS =
  'id, collection_id, category, severity, title, description, affected_node_ids, affected_edge_ids, remediation_hint, created_at, confidence, static_possible, observed, tested, path_status, test_run_ids, candidate_path_id, path_summary, source_capabilities, sink_capabilities, boundary_crossed, is_cross_server, source_server_id, sink_server_id, crosses_trust_boundary, trust_transition, explanation, evidence, lethal_trifecta_status';
const PLACEHOLDERS = '?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?';

function bind(f: FindingRow): unknown[] {
  return [
    f.id,
    f.collection_id,
    f.category,
    f.severity,
    f.title,
    f.description,
    f.affected_node_ids,
    f.affected_edge_ids ?? null,
    f.remediation_hint,
    f.created_at,
    f.confidence ?? null,
    f.static_possible ?? null,
    f.observed ?? null,
    f.tested ?? null,
    f.path_status ?? null,
    f.test_run_ids ?? null,
    f.candidate_path_id ?? null,
    f.path_summary ?? null,
    f.source_capabilities ?? null,
    f.sink_capabilities ?? null,
    f.boundary_crossed ?? null,
    f.is_cross_server ?? null,
    f.source_server_id ?? null,
    f.sink_server_id ?? null,
    f.crosses_trust_boundary ?? null,
    f.trust_transition ?? null,
    f.explanation ?? null,
    f.evidence ?? null,
    f.lethal_trifecta_status ?? null,
  ];
}

function rowToFinding(r: FindingRow): Finding {
  const finding: Finding = {
    id: r.id,
    collectionId: r.collection_id,
    category: r.category as Finding['category'],
    severity: r.severity as Finding['severity'],
    title: r.title,
    description: r.description,
    affectedNodeIds: JSON.parse(r.affected_node_ids) as string[],
    remediationHint: r.remediation_hint ?? undefined,
    createdAt: r.created_at,
  };
  if (r.affected_edge_ids) finding.affectedEdgeIds = JSON.parse(r.affected_edge_ids) as string[];
  if (r.confidence) finding.confidence = r.confidence as Confidence;
  if (r.static_possible !== null && r.static_possible !== undefined)
    finding.staticPossible = r.static_possible === 1;
  if (r.observed !== null && r.observed !== undefined) finding.observed = r.observed === 1;
  if (r.tested !== null && r.tested !== undefined) finding.tested = r.tested === 1;
  if (r.path_status) finding.pathStatus = r.path_status as PathStatus;
  if (r.test_run_ids) finding.testRunIds = JSON.parse(r.test_run_ids) as string[];
  if (r.candidate_path_id) finding.candidatePathId = r.candidate_path_id;
  if (r.path_summary) finding.pathSummary = r.path_summary;
  if (r.source_capabilities)
    finding.sourceCapabilities = JSON.parse(r.source_capabilities) as Capability[];
  if (r.sink_capabilities)
    finding.sinkCapabilities = JSON.parse(r.sink_capabilities) as Capability[];
  if (r.boundary_crossed) finding.boundaryCrossed = r.boundary_crossed as TrustBoundary;
  if (r.is_cross_server !== null && r.is_cross_server !== undefined)
    finding.isCrossServer = r.is_cross_server === 1;
  if (r.source_server_id) finding.sourceServerId = r.source_server_id;
  if (r.sink_server_id) finding.sinkServerId = r.sink_server_id;
  if (r.crosses_trust_boundary !== null && r.crosses_trust_boundary !== undefined)
    finding.crossesTrustBoundary = r.crosses_trust_boundary === 1;
  if (r.trust_transition) finding.trustTransition = r.trust_transition;
  if (r.explanation) finding.explanation = r.explanation;
  if (r.evidence) finding.evidence = JSON.parse(r.evidence) as string[];
  if (r.lethal_trifecta_status) finding.lethalTrifectaStatus = r.lethal_trifecta_status as Finding['lethalTrifectaStatus'];
  return finding;
}

export function findingToRow(f: Finding): FindingRow {
  return {
    id: f.id,
    collection_id: f.collectionId,
    category: f.category,
    severity: f.severity,
    title: f.title,
    description: f.description,
    affected_node_ids: JSON.stringify(f.affectedNodeIds),
    affected_edge_ids: f.affectedEdgeIds ? JSON.stringify(f.affectedEdgeIds) : null,
    remediation_hint: f.remediationHint ?? null,
    created_at: f.createdAt,
    confidence: f.confidence ?? null,
    static_possible: f.staticPossible === undefined ? null : f.staticPossible ? 1 : 0,
    observed: f.observed === undefined ? null : f.observed ? 1 : 0,
    tested: f.tested === undefined ? null : f.tested ? 1 : 0,
    path_status: f.pathStatus ?? null,
    test_run_ids: f.testRunIds ? JSON.stringify(f.testRunIds) : null,
    candidate_path_id: f.candidatePathId ?? null,
    path_summary: f.pathSummary ?? null,
    source_capabilities: f.sourceCapabilities ? JSON.stringify(f.sourceCapabilities) : null,
    sink_capabilities: f.sinkCapabilities ? JSON.stringify(f.sinkCapabilities) : null,
    boundary_crossed: f.boundaryCrossed ?? null,
    is_cross_server: f.isCrossServer === undefined ? null : f.isCrossServer ? 1 : 0,
    source_server_id: f.sourceServerId ?? null,
    sink_server_id: f.sinkServerId ?? null,
    crosses_trust_boundary:
      f.crossesTrustBoundary === undefined ? null : f.crossesTrustBoundary ? 1 : 0,
    trust_transition: f.trustTransition ?? null,
    explanation: f.explanation ?? null,
    evidence: f.evidence ? JSON.stringify(f.evidence) : null,
    lethal_trifecta_status: f.lethalTrifectaStatus ?? null,
  };
}

export function createFindingsRepo(db: Database.Database) {
  const insertSql = `INSERT OR REPLACE INTO findings (${COLUMNS}) VALUES (${PLACEHOLDERS})`;
  return {
    insert(finding: FindingRow): void {
      db.prepare(insertSql).run(...bind(finding));
    },

    insertMany(findings: FindingRow[]): void {
      const stmt = db.prepare(insertSql);
      const tx = db.transaction((rows: FindingRow[]) => {
        for (const f of rows) stmt.run(...bind(f));
      });
      tx(findings);
    },

    findByCollection(collectionId: string): Finding[] {
      const rows = db
        .prepare(`SELECT * FROM findings WHERE collection_id=? ORDER BY
          CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`)
        .all(collectionId) as FindingRow[];
      return rows.map(rowToFinding);
    },

    findById(id: string): Finding | undefined {
      const row = db.prepare(`SELECT * FROM findings WHERE id=?`).get(id) as FindingRow | undefined;
      return row ? rowToFinding(row) : undefined;
    },

    deleteByCollection(collectionId: string): void {
      db.prepare(`DELETE FROM findings WHERE collection_id=?`).run(collectionId);
    },
  };
}
