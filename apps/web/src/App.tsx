import React, { useState, useEffect } from 'react';
import { api } from './api.js';
import { Dashboard } from './views/Dashboard.js';
import { Graph } from './views/Graph.js';
import { Tools } from './views/Tools.js';
import { Findings } from './views/Findings.js';

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown) {
    console.error(error);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="empty-state">
          <h2>UI failed to load</h2>
          <p>Please refresh the page. If the issue persists, rebuild and restart ISeeMP.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

type View = 'dashboard' | 'graph' | 'tools' | 'findings';

function AppContent() {
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
      </main>
    </div>
  );
}

export function App() {
  return (
    <AppErrorBoundary>
      <AppContent />
    </AppErrorBoundary>
  );
}
