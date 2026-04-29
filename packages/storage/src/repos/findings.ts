import type Database from 'better-sqlite3';
import type { Finding, Capability, TrustBoundary, Confidence } from '@iseemp/core';

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
  path_summary?: string | null;
  source_capabilities?: string | null; // JSON
  sink_capabilities?: string | null; // JSON
  boundary_crossed?: string | null;
  explanation?: string | null;
  evidence?: string | null; // JSON
}

const COLUMNS =
  'id, collection_id, category, severity, title, description, affected_node_ids, affected_edge_ids, remediation_hint, created_at, confidence, static_possible, observed, tested, path_summary, source_capabilities, sink_capabilities, boundary_crossed, explanation, evidence';
const PLACEHOLDERS = '?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?';

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
    f.path_summary ?? null,
    f.source_capabilities ?? null,
    f.sink_capabilities ?? null,
    f.boundary_crossed ?? null,
    f.explanation ?? null,
    f.evidence ?? null,
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
  if (r.path_summary) finding.pathSummary = r.path_summary;
  if (r.source_capabilities)
    finding.sourceCapabilities = JSON.parse(r.source_capabilities) as Capability[];
  if (r.sink_capabilities)
    finding.sinkCapabilities = JSON.parse(r.sink_capabilities) as Capability[];
  if (r.boundary_crossed) finding.boundaryCrossed = r.boundary_crossed as TrustBoundary;
  if (r.explanation) finding.explanation = r.explanation;
  if (r.evidence) finding.evidence = JSON.parse(r.evidence) as string[];
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
    path_summary: f.pathSummary ?? null,
    source_capabilities: f.sourceCapabilities ? JSON.stringify(f.sourceCapabilities) : null,
    sink_capabilities: f.sinkCapabilities ? JSON.stringify(f.sinkCapabilities) : null,
    boundary_crossed: f.boundaryCrossed ?? null,
    explanation: f.explanation ?? null,
    evidence: f.evidence ? JSON.stringify(f.evidence) : null,
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

    deleteByCollection(collectionId: string): void {
      db.prepare(`DELETE FROM findings WHERE collection_id=?`).run(collectionId);
    },
  };
}
