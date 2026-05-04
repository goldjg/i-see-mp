import React, { useState, useEffect } from 'react';
import { api } from './api.js';
import { Dashboard } from './views/Dashboard.js';
import { Graph } from './views/Graph.js';
import { Tools } from './views/Tools.js';
import { Findings } from './views/Findings.js';
import { Logs } from './views/Logs.js';
import logoUrl from './assets/logo.png';

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

type View = 'dashboard' | 'graph' | 'tools' | 'findings' | 'logs';
const COLLAPSIBLE_NAV_ACTIVE_VAR = '--sidebar-collapsible-active';

function AppContent() {
  const [view, setView] = useState<View>('dashboard');
  const [isNavOpen, setIsNavOpen] = useState<boolean>(false);
  const [trifectaNodeIds, setTrifectaNodeIds] = useState<Set<string>>(new Set());
  const [completeNodeIds, setCompleteNodeIds] = useState<Set<string>>(new Set());
  const [logsFilters, setLogsFilters] = useState<{
    collectionId?: string;
    findingId?: string;
    testRunId?: string;
  }>({});

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

  useEffect(() => {
    let resizeFrame: number | null = null;

    function syncNavStateToViewport() {
      const shouldBeOpen = !isCollapsibleNavActive();
      setIsNavOpen((current) => (current === shouldBeOpen ? current : shouldBeOpen));
    }

    function onResize() {
      if (resizeFrame !== null) return;
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        syncNavStateToViewport();
      });
    }

    syncNavStateToViewport();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
      }
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (!isNavOpen || event.key !== 'Escape') return;
      if (isCollapsibleNavActive()) {
        setIsNavOpen(false);
      }
    }

    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [isNavOpen]);

  useEffect(() => {
    if (!isNavOpen || !isCollapsibleNavActive()) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isNavOpen]);

  function switchTo(v: View) {
    setView(v);
    if (isCollapsibleNavActive()) {
      setIsNavOpen(false);
    }
  }

  function showLogs(filters: { collectionId?: string; findingId?: string; testRunId?: string }) {
    setLogsFilters(filters);
    switchTo('logs');
  }

  return (
    <div className="app-shell">
      <header className="mobile-header">
        <button
          className="nav-toggle"
          aria-label={isNavOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={isNavOpen}
          aria-controls="sidebar"
          onClick={() => setIsNavOpen((prev) => !prev)}
        >
          <span className="hamburger-bar" aria-hidden="true" />
          <span className="hamburger-bar" aria-hidden="true" />
          <span className="hamburger-bar" aria-hidden="true" />
        </button>
        <img src={logoUrl} alt="ISeeMP" className="mobile-logo-img" />
      </header>
      <div
        className={`mobile-nav-backdrop${isNavOpen ? ' open' : ''}`}
        aria-hidden="true"
        onClick={() => setIsNavOpen(false)}
      />
      <nav id="sidebar" className={`sidebar${isNavOpen ? ' sidebar-open' : ''}`}>
        <div className="logo">
          <img src={logoUrl} alt="ISeeMP logo" className="logo-img" />
        </div>
        <ul>
          {(['dashboard', 'graph', 'tools', 'findings', 'logs'] as View[]).map((v) => (
            <li key={v} className={view === v ? 'active' : ''}>
              <button onClick={() => switchTo(v)}>
                {v === 'dashboard' && '📊 '}
                {v === 'graph' && '🕸️ '}
                {v === 'tools' && '🔧 '}
                {v === 'findings' && '🚨 '}
                {v === 'logs' && '🪵 '}
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
          <Findings onShowOnGraph={() => switchTo('graph')} onShowLogs={showLogs} />
        )}
        {view === 'logs' && <Logs initialFilters={logsFilters} />}
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
  function isCollapsibleNavActive(): boolean {
    return getComputedStyle(document.documentElement)
      .getPropertyValue(COLLAPSIBLE_NAV_ACTIVE_VAR)
      .trim() === '1';
  }
