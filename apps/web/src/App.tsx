import React, { useState, Suspense, lazy, useEffect } from 'react';
import { api } from './api.js';

const Dashboard = lazy(() => import('./views/Dashboard.js').then((m) => ({ default: m.Dashboard })));
const Graph = lazy(() => import('./views/Graph.js').then((m) => ({ default: m.Graph })));
const Tools = lazy(() => import('./views/Tools.js').then((m) => ({ default: m.Tools })));
const Findings = lazy(() => import('./views/Findings.js').then((m) => ({ default: m.Findings })));

type View = 'dashboard' | 'graph' | 'tools' | 'findings';

export function App() {
  const [view, setView] = useState<View>('dashboard');
  const [trifectaNodeIds, setTrifectaNodeIds] = useState<Set<string>>(new Set());
  const [completeNodeIds, setCompleteNodeIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    async function loadTrifectaNodeSets() {
      try {
        const cols = await api.collections();
        const latest = cols[0];
        if (!latest) return;
        const findings = await api.findings(latest.id);
        if (cancelled) return;

        const trifecta = new Set<string>();
        const complete = new Set<string>();

        for (const finding of findings) {
          if (finding.trifectaStage === 'COMPLETE') {
            for (const nodeId of finding.affectedNodeIds) {
              trifecta.add(nodeId);
              complete.add(nodeId);
            }
            continue;
          }
          if (finding.trifectaStage === 'PARTIAL') {
            for (const nodeId of finding.affectedNodeIds) {
              trifecta.add(nodeId);
            }
          }
        }

        setTrifectaNodeIds(trifecta);
        setCompleteNodeIds(complete);
      } catch (e) {
        console.error(e);
      }
    }

    void loadTrifectaNodeSets();
    return () => {
      cancelled = true;
    };
  }, []);

  function switchTo(v: View) {
    setView(v);
  }

  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="logo">
          <span className="logo-icon">🔍</span>
          <span className="logo-text">ISeeMP</span>
        </div>
        <ul>
          {(['dashboard', 'graph', 'tools', 'findings'] as View[]).map((v) => (
            <li key={v} className={view === v ? 'active' : ''}>
              <button onClick={() => switchTo(v)}>
                {v === 'dashboard' && '📊 '}
                {v === 'graph' && '🕸️ '}
                {v === 'tools' && '🔧 '}
                {v === 'findings' && '🚨 '}
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <main className="main-content">
        <Suspense fallback={<div style={{ padding: '2rem', color: '#888' }}>Loading…</div>}>
          {view === 'dashboard' && <Dashboard />}
          {view === 'graph' && (
            <Graph
              onSelectNode={() => {}}
              trifectaNodeIds={trifectaNodeIds}
              completeNodeIds={completeNodeIds}
            />
          )}
          {view === 'tools' && <Tools />}
          {view === 'findings' && (
            <Findings onShowOnGraph={() => switchTo('graph')} />
          )}
        </Suspense>
      </main>
    </div>
  );
}
