import React, { useState, Suspense, lazy } from 'react';

const Dashboard = lazy(() => import('./views/Dashboard.js').then((m) => ({ default: m.Dashboard })));
const Graph = lazy(() => import('./views/Graph.js').then((m) => ({ default: m.Graph })));
const Tools = lazy(() => import('./views/Tools.js').then((m) => ({ default: m.Tools })));
const Findings = lazy(() => import('./views/Findings.js').then((m) => ({ default: m.Findings })));

type View = 'dashboard' | 'graph' | 'tools' | 'findings';

export function App() {
  const [view, setView] = useState<View>('dashboard');

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
            <Graph onSelectNode={() => {}} />
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
