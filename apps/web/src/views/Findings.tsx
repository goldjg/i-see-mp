import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import type { Finding, TestRunDetail } from '../api.js';

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#ca8a04',
  low: '#16a34a',
  info: '#2563eb',
};

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

function FindingBadges({ finding }: { finding: Finding }) {
  const badges: Array<{ label: string; cls: string; title: string }> = [];

  // Static / Tested / Observed badges. Always show "Static" if staticPossible is set.
  if (finding.staticPossible) {
    badges.push({
      label: 'Static',
      cls: 'badge-static',
      title: 'Statically inferred from tool capabilities (lower confidence).',
    });
  }
  if (finding.tested) {
    if (finding.pathStatus === 'tested_confirmed') {
      badges.push({
        label: 'Confirmed',
        cls: 'badge-tested-confirmed',
        title: 'Path confirmed by deterministic test (canary observed at mock sink).',
      });
    } else if (finding.pathStatus === 'tested_rejected') {
      badges.push({
        label: 'Rejected',
        cls: 'badge-tested-rejected',
        title: 'Path execution was blocked before sink; finding downgraded.',
      });
    } else {
      badges.push({
        label: 'Inconclusive',
        cls: 'badge-tested-inconclusive',
        title: 'Test attempted but results were inconclusive.',
      });
    }
  }
  if (finding.observed) {
    badges.push({
      label: 'Observed',
      cls: 'badge-observed',
      title: 'Canary value was observed at the local mock sink.',
    });
  }
  if (finding.confidence) {
    badges.push({
      label: `conf:${finding.confidence}`,
      cls: 'badge-confidence',
      title: `Confidence is ${finding.confidence}.`,
    });
  }

  if (badges.length === 0) return null;
  return (
    <span className="finding-badges">
      {badges.map((b) => (
        <span key={b.label} className={`finding-badge ${b.cls}`} title={b.title}>
          {b.label}
        </span>
      ))}
    </span>
  );
}

function EvidenceSummary({ findingId }: { findingId: string }) {
  const [runs, setRuns] = useState<TestRunDetail[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const list = await api.testRuns({ findingId });
        if (!list || list.length === 0) {
          if (!cancelled) {
            setRuns([]);
            setLoading(false);
          }
          return;
        }
        const details = await Promise.all(list.map((r) => api.testRun(r.id)));
        if (!cancelled) {
          setRuns(details);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [findingId]);

  if (loading) return <p className="evidence-loading">Loading evidence…</p>;
  if (error) return <p className="evidence-error">Evidence error: {error}</p>;
  if (!runs || runs.length === 0) {
    return <p className="evidence-empty">No test runs recorded for this finding.</p>;
  }

  return (
    <div className="evidence-summary">
      <h4>Test Evidence ({runs.length})</h4>
      {runs.map((r) => (
        <div key={r.id} className="evidence-run">
          <div className="evidence-run-header">
            <strong>{r.testCaseName}</strong>
            <span className={`finding-badge badge-path-${r.pathStatus}`}>{r.pathStatus}</span>
            <span className="evidence-run-id">{r.id}</span>
          </div>
          {r.outcome && <p><strong>Outcome:</strong> {r.outcome}</p>}
          <p><strong>Timestamp:</strong> {r.timestamp ?? r.startedAt}</p>
          {r.pathSummary && <p className="evidence-path"><code>{r.pathSummary}</code></p>}
          <details>
            <summary>Plan</summary>
            <pre>{r.plan}</pre>
          </details>
          <details>
            <summary>Tool call sequence ({r.toolCalls.length})</summary>
            <ol className="evidence-calls">
              {r.toolCalls.map((c, i) => (
                <li key={i}>
                  <strong>{c.toolName}</strong>
                  <details>
                    <summary>input (redacted)</summary>
                    <pre>{JSON.stringify(c.input, null, 2)}</pre>
                  </details>
                  <details>
                    <summary>output (redacted)</summary>
                    <pre>{JSON.stringify(c.output, null, 2)}</pre>
                  </details>
                  {c.error && <p className="evidence-error">error: {c.error}</p>}
                </li>
              ))}
            </ol>
          </details>
          <p>
            Canary observed: <strong>{r.canaryObserved ? 'true' : 'false'}</strong>
            {r.canaryExpected && (
              <>
                {' '}— expected marker: <code>{r.canaryExpected}</code>
              </>
            )}
          </p>
          {r.notes && <p className="evidence-notes">Notes: {r.notes}</p>}
        </div>
      ))}
    </div>
  );
}

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
                  <FindingBadges finding={f} />
                  <span className="finding-category">{f.category}</span>
                </div>
                {expanded.has(f.id) && (
                  <div className="finding-body">
                    <p>{f.description}</p>
                    {f.pathSummary && (
                      <p><strong>Path:</strong> <code>{f.pathSummary}</code></p>
                    )}
                    {f.explanation && (
                      <p className="explanation"><strong>Explanation:</strong> {f.explanation}</p>
                    )}
                    {f.remediationHint && (
                      <p className="remediation"><strong>Remediation:</strong> {f.remediationHint}</p>
                    )}
                    {f.affectedNodeIds.length > 0 && (
                      <p><strong>Affected nodes:</strong> {f.affectedNodeIds.join(', ')}</p>
                    )}
                    {(f.tested || (f.testRunIds && f.testRunIds.length > 0)) && (
                      <EvidenceSummary findingId={f.id} />
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
