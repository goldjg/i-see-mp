import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import type { Collection, Finding } from '../api.js';

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];
const SEVERITY_COLOR: Record<string, string> = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#ca8a04',
  low: '#16a34a',
  info: '#2563eb',
};

export function Dashboard() {
  const [collection, setCollection] = useState<Collection | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [capMap, setCapMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const cols = await api.collections();
        const latest = cols[0] ?? null;
        setCollection(latest);
        if (latest) {
          const [f, tools] = await Promise.all([
            api.findings(latest.id),
            api.tools(latest.id),
          ]);
          setFindings(f);
          const counts: Record<string, number> = {};
          for (const tool of tools) {
            for (const cap of tool.capabilities) {
              counts[cap] = (counts[cap] ?? 0) + 1;
            }
          }
          setCapMap(counts);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  if (loading) return <div className="loading">Loading…</div>;
  if (!collection) {
    return (
      <div className="empty-state">
        <h2>No collections yet</h2>
        <p>Run <code>mcphound collect</code> to scan your MCP servers.</p>
      </div>
    );
  }

  const topFindings = [...findings].slice(0, 5);
  const maxCap = Math.max(...Object.values(capMap), 1);

  return (
    <div className="dashboard">
      <h1>Dashboard</h1>
      <div className="stat-cards">
        <div className="stat-card"><div className="stat-value">{collection.serverCount}</div><div className="stat-label">Servers</div></div>
        <div className="stat-card"><div className="stat-value">{collection.toolCount}</div><div className="stat-label">Tools</div></div>
        <div className="stat-card"><div className="stat-value">{collection.resourceCount}</div><div className="stat-label">Resources</div></div>
        <div className="stat-card"><div className="stat-value">{findings.length}</div><div className="stat-label">Findings</div></div>
      </div>

      <h2>Capability Histogram</h2>
      <div className="cap-histogram">
        {Object.entries(capMap).sort((a, b) => b[1] - a[1]).map(([cap, count]) => (
          <div key={cap} className="cap-bar-row">
            <span className="cap-label">{cap}</span>
            <div className="cap-bar-bg">
              <div className="cap-bar-fill" style={{ width: `${(count / maxCap) * 100}%` }} />
            </div>
            <span className="cap-count">{count}</span>
          </div>
        ))}
      </div>

      <h2>Top Findings</h2>
      <div className="findings-list">
        {topFindings.map((f) => (
          <div key={f.id} className="finding-card">
            <span className="severity-badge" style={{ background: SEVERITY_COLOR[f.severity] }}>
              {f.severity.toUpperCase()}
            </span>
            <span className="finding-title">{f.title}</span>
          </div>
        ))}
        {topFindings.length === 0 && <p>No findings — looks clean!</p>}
      </div>
    </div>
  );
}
