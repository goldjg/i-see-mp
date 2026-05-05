import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import type { Tool } from '../api.js';

const CAP_COLORS: Record<string, string> = {
  // Execution (highest)
  RUN_SHELL: '#dc2626',
  EXECUTE_CODE: '#dc2626',
  // Sensitivity tiers
  READ_CREDENTIAL_HIGH: '#dc2626',
  READ_SECRET_HIGH: '#ea580c',
  READ_SECRET: '#ea580c', // legacy
  READ_SENSITIVE_MEDIUM: '#ca8a04',
  READ_METADATA_LOW: '#65a30d',
  // Identity / cloud
  MUTATE_IDENTITY: '#ea580c',
  MUTATE_CLOUD_RESOURCE: '#ca8a04',
  // Mutation (remote)
  MUTATE_REPOSITORY: '#a16207',
  MUTATE_REMOTE_STATE: '#7c3aed',
  MUTATE_ISSUE_OR_PR: '#7c3aed',
  // Network
  SEND_EXTERNAL: '#2563eb',
  SEND_HTTP: '#2563eb',
  SEND_EMAIL: '#9333ea',
  // Files
  WRITE_LOCAL_FILE: '#7c3aed',
  WRITE_REMOTE_DATA: '#7c3aed',
  READ_LOCAL_FILE: '#0891b2',
  READ_REMOTE_DATA: '#0891b2',
  // Query
  QUERY_DATABASE: '#0284c7',
  QUERY_REMOTE_SYSTEM: '#0ea5e9',
  // Misc
  CREATE_TICKET: '#16a34a',
  EXPORT_DATA: '#db2777',
  UNKNOWN: '#94a3b8',
};

type SortKey = 'name' | 'riskScore' | 'serverId';

export function Tools() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>('riskScore');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const cols = await api.collections();
        if (!cols[0]) return;
        const t = await api.tools(cols[0].id);
        setTools(t);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const sorted = [...tools].sort((a, b) => {
    const av = a[sortKey] ?? '';
    const bv = b[sortKey] ?? '';
    const cmp = typeof av === 'number' ? av - (bv as number) : String(av).localeCompare(String(bv));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  if (loading) return <div className="loading">Loading…</div>;

  return (
    <div className="tools-view">
      <h1>Tools</h1>
      <table className="tools-table">
        <thead>
          <tr>
            <th onClick={() => handleSort('name')} className="sortable">
              Name {sortKey === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
            </th>
            <th onClick={() => handleSort('serverId')} className="sortable">
              Server {sortKey === 'serverId' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
            </th>
            <th>Capabilities</th>
            <th onClick={() => handleSort('riskScore')} className="sortable">
              Risk {sortKey === 'riskScore' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((tool) => (
            <React.Fragment key={tool.id}>
              <tr
                className="tool-row"
                onClick={() =>
                  setExpanded((s) => {
                    const n = new Set(s);
                    if (n.has(tool.id)) {
                      n.delete(tool.id);
                    } else {
                      n.add(tool.id);
                    }
                    return n;
                  })
                }
              >
                <td>{tool.name}</td>
                <td>
                  <code>{tool.serverId.split(':').pop()}</code>
                </td>
                <td>
                  <div className="cap-badges">
                    {tool.capabilities.map((c) => (
                      <span
                        key={c}
                        className="cap-badge"
                        style={{ background: CAP_COLORS[c] ?? '#64748b' }}
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </td>
                <td>
                  <div className="risk-bar">
                    <div
                      className="risk-fill"
                      style={{
                        width: `${tool.riskScore}%`,
                        background:
                          tool.riskScore >= 80
                            ? '#dc2626'
                            : tool.riskScore >= 60
                              ? '#ea580c'
                              : '#16a34a',
                      }}
                    />
                    <span>{tool.riskScore}</span>
                  </div>
                </td>
              </tr>
              {expanded.has(tool.id) && (
                <tr className="tool-detail-row">
                  <td colSpan={4}>
                    {tool.description && (
                      <p>
                        <strong>Description:</strong> {tool.description}
                      </p>
                    )}
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
      {tools.length === 0 && <p className="empty-state">No tools found. Run collect first.</p>}
    </div>
  );
}
