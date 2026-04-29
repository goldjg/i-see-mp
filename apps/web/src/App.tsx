import React, { useState } from 'react';
import { Dashboard } from './views/Dashboard.js';
import { Graph } from './views/Graph.js';
import { Tools } from './views/Tools.js';
import { Findings } from './views/Findings.js';

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
          <span className="logo-text">MCPHound</span>
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
          <Graph onSelectNode={() => {}} />
        )}
        {view === 'tools' && <Tools />}
        {view === 'findings' && (
          <Findings onShowOnGraph={() => switchTo('graph')} />
        )}
      </main>
    </div>
  );
}
