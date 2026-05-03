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

const TRIFECTA_LABEL: Record<'COMPLETE' | 'PARTIAL' | 'CAPABILITY_ONLY', string> = {
  COMPLETE: 'Complete',
  PARTIAL: 'Partial',
  CAPABILITY_ONLY: 'Capability only',
};

const TRIFECTA_EXPLANATION: Record<'COMPLETE' | 'PARTIAL' | 'CAPABILITY_ONLY', string> = {
  COMPLETE:
    'Dataflow source, model context, and a send/mutation sink are all present — this is a structural source-to-sink path, not proof of prompt-injection exploitability.',
  PARTIAL:
    'At least one side of the source/sink chain is present, but a full structural source-to-sink chain is not present.',
  CAPABILITY_ONLY:
    'This is a standalone exposed capability and is not currently part of a structural source-to-sink chain.',
};

function renderCapabilityList(list: string[] | undefined): string {
  if (!list || list.length === 0) return 'not present';
  return list.join(', ');
}

export function FindingBadges({ finding }: { finding: Finding }) {
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
    } else if (finding.pathStatus === 'trust_boundary_exploit_confirmed') {
      badges.push({
        label: 'Exploit Confirmed',
        cls: 'badge-tested-confirmed',
        title: 'Prompt-injection exploit confirmed across a trust boundary.',
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
  if (finding.trifectaStage === 'COMPLETE') {
    badges.push({
      label: 'TRIFECTA_COMPLETE',
      cls: 'badge-trifecta-complete',
      title:
        'Structural dataflow complete: source + model context + sink are present. This does not by itself prove prompt-injection exploitability.',
    });
  } else if (finding.trifectaStage === 'PARTIAL') {
    badges.push({
      label: 'TRIFECTA_PARTIAL',
      cls: 'badge-trifecta-partial',
      title:
        'Structural dataflow partial: source or sink side is present, but not a full source-to-sink chain.',
    });
  } else if (finding.trifectaStage === 'CAPABILITY_ONLY') {
    badges.push({
      label: 'CAPABILITY_ONLY',
      cls: 'badge-trifecta-capability',
      title:
        'Single capability present. Not part of a detected structural complete or partial chain.',
    });
  }
  if (finding.lethalTrifectaStatus === 'CANDIDATE' || finding.lethalTrifectaStatus === 'POSSIBLE') {
    badges.push({
      label: 'LETHAL_TRIFECTA_POSSIBLE',
      cls: 'badge-lethal-trifecta-candidate',
      title:
        'Untrusted-content exposure + private data access + external communication are all present. This is a prompt-injection candidate path, not a confirmed exploit.',
    });
  } else if (finding.lethalTrifectaStatus === 'COMPLETE' || finding.lethalTrifectaStatus === 'CONFIRMED') {
    badges.push({
      label: 'LETHAL_TRIFECTA_CONFIRMED',
      cls: 'badge-lethal-trifecta-complete',
      title: 'Lethal trifecta was confirmed.',
    });
  }
  if (finding.isCrossServer && finding.crossesTrustBoundary) {
    badges.push({
      label: 'TRUST_BOUNDARY',
      cls: 'badge-trust-boundary',
      title: 'Cross-server path that crosses a trust boundary.',
    });
  } else if (finding.isCrossServer) {
    badges.push({
      label: 'CROSS_SERVER',
      cls: 'badge-cross-server',
      title: 'Cross-server path without a trust-boundary transition.',
    });
  }
  if (finding.isHighSignal) {
    badges.push({
      label: 'HIGH_SIGNAL',
      cls: 'badge-high-signal',
      title: 'Structurally complete path that also crosses a trust boundary.',
    });
  }
  if (finding.subCategory) {
    const cls =
      finding.subCategory === 'PROMPT_INJECTION_CONFIRMED'
        ? 'badge-subcategory-prompt-confirmed'
        : finding.subCategory === 'PROMPT_INJECTION_EXPLOIT_CHAIN'
          ? 'badge-subcategory-prompt-confirmed'
          : finding.subCategory === 'PROMPT_INJECTION_BEHAVIOURAL'
            ? 'badge-subcategory-prompt-behavioural'
            : finding.subCategory === 'TRUST_BOUNDARY_EXPLOIT_CONFIRMED'
              ? 'badge-subcategory-trust-confirmed'
          : finding.subCategory === 'TRUST_BOUNDARY_CONFIRMED'
            ? 'badge-subcategory-trust-confirmed'
            : 'badge-subcategory-prompt-possible';
    badges.push({
      label: finding.subCategory,
      cls,
      title: `Sub-classification: ${finding.subCategory}`,
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

export function TrifectaExplanation({ finding }: { finding: Finding }) {
  if (
    finding.trifectaStage !== 'COMPLETE' &&
    finding.trifectaStage !== 'PARTIAL' &&
    finding.trifectaStage !== 'CAPABILITY_ONLY'
  ) {
    return null;
  }

  return (
    <div className="trifecta-explanation">
      <div className="trifecta-row">
        <span className="trifecta-label">Classification</span>
        <span className="trifecta-value">{TRIFECTA_LABEL[finding.trifectaStage]}</span>
      </div>
      {finding.isCrossServer && (
        <>
          <div className="trifecta-row">
            <span className="trifecta-label">Path type</span>
            <span className="trifecta-value">Cross-server path candidate</span>
          </div>
          <div className="trifecta-row">
            <span className="trifecta-label">Servers</span>
            <span className="trifecta-value">{`${finding.sourceServerId ?? 'unknown'} → ${finding.sinkServerId ?? 'unknown'}`}</span>
          </div>
          <div className="trifecta-row">
            <span className="trifecta-label">Trust transition</span>
            <span className="trifecta-value">{finding.trustTransition ?? 'unknown'}</span>
          </div>
          <div className="trifecta-row">
            <span className="trifecta-label">Trust boundary</span>
            <span className="trifecta-value">
              {finding.crossesTrustBoundary ? 'Crossed' : 'Not crossed'}
            </span>
          </div>
        </>
      )}
      <div className="trifecta-row">
        <span className="trifecta-label">Source</span>
        <span className="trifecta-value">{renderCapabilityList(finding.sourceCapabilities)}</span>
      </div>
      <div className="trifecta-row">
        <span className="trifecta-label">Transform</span>
        <span className="trifecta-value">MODEL_CONTEXT (implicit)</span>
      </div>
      <div className="trifecta-row">
        <span className="trifecta-label">Sink</span>
        <span className="trifecta-value">{renderCapabilityList(finding.sinkCapabilities)}</span>
      </div>
      <div className="trifecta-row">
        <span className="trifecta-label">Private data access</span>
        <span className="trifecta-value">{finding.hasPrivateDataAccess ? 'Yes' : 'No'}</span>
      </div>
      <div className="trifecta-row">
        <span className="trifecta-label">Untrusted content exposure</span>
        <span className="trifecta-value">{finding.hasUntrustedContentExposure ? 'Yes' : 'No'}</span>
      </div>
      <div className="trifecta-row">
        <span className="trifecta-label">External communication</span>
        <span className="trifecta-value">{finding.hasExternalCommunication ? 'Yes' : 'No'}</span>
      </div>
      <div className="trifecta-row">
        <span className="trifecta-label">Prompt-injection risk status</span>
        <span className="trifecta-value">{finding.lethalTrifectaStatus ?? 'NONE'}</span>
      </div>
      <p className="trifecta-sentence">{TRIFECTA_EXPLANATION[finding.trifectaStage]}</p>
    </div>
  );
}

export function TrifectaLegend() {
  return (
    <details className="trifecta-legend">
      <summary>ℹ️ Trifecta classification guide</summary>
      <div className="legend-row">
        <span className="finding-badge badge-trifecta-complete legend-badge">TRIFECTA_COMPLETE</span>
        <span className="legend-text">
          Structural source + model context + sink path is present (dataflow/exfil capability).
        </span>
      </div>
      <div className="legend-row">
        <span className="finding-badge badge-trifecta-partial legend-badge">TRIFECTA_PARTIAL</span>
        <span className="legend-text">
          Structural source or sink side is present, but no complete source-to-sink path.
        </span>
      </div>
      <div className="legend-row">
        <span className="finding-badge badge-trifecta-capability legend-badge">CAPABILITY_ONLY</span>
        <span className="legend-text">
          Standalone capability exposure without a detected structural chain.
        </span>
      </div>
      <div className="legend-row">
        <span className="finding-badge badge-lethal-trifecta-candidate legend-badge">
          LETHAL_TRIFECTA_POSSIBLE
        </span>
        <span className="legend-text">
          Candidate prompt-injection path: private data access + untrusted content exposure + external communication.
        </span>
      </div>
    </details>
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
          {typeof r.deviationScore === 'number' && (
            <p><strong>Deviation score:</strong> {r.deviationScore}</p>
          )}
          {r.injectionChain && r.injectionChain.length > 0 && (
            <details>
              <summary>Injection chain ({r.injectionChain.length})</summary>
              <ol className="evidence-calls">
                {r.injectionChain.map((step, idx) => (
                  <li key={`${step.step}-${idx}`}>
                    <code>
                      {step.serverId ?? 'unknown-server'} → {step.toolName} (marker: {step.markerPresent ? 'yes' : 'no'})
                    </code>
                  </li>
                ))}
              </ol>
            </details>
          )}
          {r.trustBoundaryExploitConfirmed && (
            <p><strong>Trust boundary exploit:</strong> confirmed</p>
          )}
          {r.notes && <p className="evidence-notes">Notes: {r.notes}</p>}
        </div>
      ))}
    </div>
  );
}

export function Findings({ onShowOnGraph }: { onShowOnGraph?: (nodeIds: string[]) => void }) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'trifecta' | 'severity'>('trifecta');
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
  const trifectaGroups: Array<{ key: 'COMPLETE' | 'PARTIAL' | 'CAPABILITY_ONLY'; label: string; items: Finding[] }> = [
    {
      key: 'COMPLETE',
      label: 'TRIFECTA_COMPLETE',
      items: findings.filter((f) => f.trifectaStage === 'COMPLETE'),
    },
    {
      key: 'PARTIAL',
      label: 'TRIFECTA_PARTIAL',
      items: findings.filter((f) => f.trifectaStage === 'PARTIAL'),
    },
    {
      key: 'CAPABILITY_ONLY',
      label: 'CAPABILITY_ONLY',
      items: findings.filter((f) => f.trifectaStage === 'CAPABILITY_ONLY'),
    },
  ];

  function renderFindingCard(f: Finding) {
    return (
      <div key={f.id} className="finding-card-full">
        <div className="finding-header" onClick={() => setExpanded((s) => {
          const n = new Set(s);
          if (n.has(f.id)) {
            n.delete(f.id);
          } else {
            n.add(f.id);
          }
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
            {f.trustTransition && (
              <p><strong>Trust transition:</strong> <code>{f.trustTransition}</code></p>
            )}
            {f.explanation && (
              <p className="explanation"><strong>Explanation:</strong> {f.explanation}</p>
            )}
            <TrifectaExplanation finding={f} />
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
    );
  }

  return (
    <div className="findings-view">
      <h1>Findings ({findings.length})</h1>
      {findings.length === 0 && <p className="empty-state">No findings — looks clean! Run <code>iseemp analyze</code> if you haven't already.</p>}
      <div className="findings-view-mode">
        <button
          className={viewMode === 'trifecta' ? 'active' : ''}
          onClick={() => setViewMode('trifecta')}
        >
          Focused (Exploitable Paths)
        </button>
        <button
          className={viewMode === 'severity' ? 'active' : ''}
          onClick={() => setViewMode('severity')}
        >
          All Findings (by Severity)
        </button>
      </div>
      <TrifectaLegend />
      {viewMode === 'trifecta' &&
        trifectaGroups.map((group) => {
          if (group.items.length === 0) return null;
          return (
            <div key={group.key} className="findings-group">
              <h2>{group.label} ({group.items.length})</h2>
              {group.items.map((f) => renderFindingCard(f))}
            </div>
          );
        })}
      {viewMode === 'severity' &&
        SEVERITY_ORDER.map((sev) => {
          const group = grouped[sev] ?? [];
          if (group.length === 0) return null;
          return (
            <div key={sev} className="findings-group">
              <h2 style={{ color: SEVERITY_COLOR[sev] }}>{sev.toUpperCase()} ({group.length})</h2>
              {group.map((f) => renderFindingCard(f))}
            </div>
          );
        })}
    </div>
  );
}
