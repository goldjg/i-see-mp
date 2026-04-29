import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import type { Finding } from '../api.js';

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#ca8a04',
  low: '#16a34a',
  info: '#2563eb',
};

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

export function Findings({ onShowOnGraph }: { onShowOnGraph?: (nodeIds: string[]) => void }) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const cols = await api.collections();
        if (!cols[0]) return;
        const f = await api.findings(cols[0].id);
        setFindings(f);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  if (loading) return <div className="loading">Loading…</div>;

  const grouped = SEVERITY_ORDER.reduce<Record<string, Finding[]>>((acc, sev) => {
    acc[sev] = findings.filter((f) => f.severity === sev);
    return acc;
  }, {});

  return (
    <div className="findings-view">
      <h1>Findings ({findings.length})</h1>
      {findings.length === 0 && <p className="empty-state">No findings — looks clean! Run <code>iseemp analyze</code> if you haven't already.</p>}
      {SEVERITY_ORDER.map((sev) => {
        const group = grouped[sev] ?? [];
        if (group.length === 0) return null;
        return (
          <div key={sev} className="findings-group">
            <h2 style={{ color: SEVERITY_COLOR[sev] }}>{sev.toUpperCase()} ({group.length})</h2>
            {group.map((f) => (
              <div key={f.id} className="finding-card-full">
                <div className="finding-header" onClick={() => setExpanded((s) => {
                  const n = new Set(s);
                  n.has(f.id) ? n.delete(f.id) : n.add(f.id);
                  return n;
                })}>
                  <span className="severity-dot" style={{ background: SEVERITY_COLOR[f.severity] }} />
                  <span className="finding-title">{f.title}</span>
                  <span className="finding-category">{f.category}</span>
                </div>
                {expanded.has(f.id) && (
                  <div className="finding-body">
                    <p>{f.description}</p>
                    {f.remediationHint && (
                      <p className="remediation"><strong>Remediation:</strong> {f.remediationHint}</p>
                    )}
                    {f.affectedNodeIds.length > 0 && (
                      <p><strong>Affected nodes:</strong> {f.affectedNodeIds.join(', ')}</p>
                    )}
                    {onShowOnGraph && (
                      <button
                        className="show-on-graph-btn"
                        onClick={() => onShowOnGraph(f.affectedNodeIds)}
                      >
                        Show on graph →
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
