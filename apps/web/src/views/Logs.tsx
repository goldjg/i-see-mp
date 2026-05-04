import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import type { Collection, LogEntry } from '../api.js';

export interface LogsViewFilters {
  collectionId?: string;
  findingId?: string;
  testRunId?: string;
}

export function Logs({ initialFilters }: { initialFilters?: LogsViewFilters }) {
  const [items, setItems] = useState<LogEntry[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [phase, setPhase] = useState<string>('');
  const [level, setLevel] = useState<string>('');
  const [q, setQ] = useState<string>('');
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>(initialFilters?.collectionId ?? '');

  const findingId = initialFilters?.findingId;
  const testRunId = initialFilters?.testRunId;
  const fixedCollectionId = initialFilters?.collectionId;

  useEffect(() => {
    let cancelled = false;
    async function loadCollections() {
      try {
        const data = await api.collections();
        if (!cancelled) {
          setCollections(data);
        }
      } catch {
        // ignore; logs table still works without collection options
      }
    }
    void loadCollections();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSelectedCollectionId(initialFilters?.collectionId ?? '');
  }, [initialFilters?.collectionId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const collectionFilter = fixedCollectionId ?? (selectedCollectionId || undefined);
        const res = await api.logs({
          collectionId: collectionFilter,
          findingId,
          testRunId,
          phase: phase ? (phase as 'collect' | 'analyze' | 'test' | 'serve' | 'demo') : undefined,
          level: level ? (level as 'info' | 'warn' | 'error') : undefined,
          q: q || undefined,
          limit: 100,
          offset: 0,
        });
        if (cancelled) return;
        setItems(res.items);
        setHasMore(res.hasMore);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [fixedCollectionId, selectedCollectionId, findingId, testRunId, phase, level, q]);

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const collectionFilter = fixedCollectionId ?? (selectedCollectionId || undefined);
      const res = await api.logs({
        collectionId: collectionFilter,
        findingId,
        testRunId,
        phase: phase ? (phase as 'collect' | 'analyze' | 'test' | 'serve' | 'demo') : undefined,
        level: level ? (level as 'info' | 'warn' | 'error') : undefined,
        q: q || undefined,
        limit: 100,
        offset: items.length,
      });
      setItems((prev) => [...prev, ...res.items]);
      setHasMore(res.hasMore);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMore(false);
    }
  }

  const chips = useMemo(() => {
    const out: string[] = [];
    if (fixedCollectionId) out.push(`collection: ${fixedCollectionId}`);
    if (findingId) out.push(`finding: ${findingId}`);
    if (testRunId) out.push(`testRun: ${testRunId}`);
    return out;
  }, [fixedCollectionId, findingId, testRunId]);

  if (loading) return <div className="loading">Loading…</div>;

  return (
    <div className="logs-view">
      <h1>Logs</h1>
      <div className="logs-filters">
        <select
          aria-label="Filter by collection"
          value={fixedCollectionId ?? selectedCollectionId}
          onChange={(e) => setSelectedCollectionId(e.target.value)}
          disabled={Boolean(fixedCollectionId)}
        >
          <option value="">All collections</option>
          {collections.map((collection) => (
            <option key={collection.id} value={collection.id}>
              {collection.id}
            </option>
          ))}
        </select>
        <select aria-label="Filter by phase" value={phase} onChange={(e) => setPhase(e.target.value)}>
          <option value="">All phases</option>
          <option value="collect">collect</option>
          <option value="analyze">analyze</option>
          <option value="test">test</option>
          <option value="serve">serve</option>
          <option value="demo">demo</option>
        </select>
        <select aria-label="Filter by level" value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="">All levels</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </select>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search messages…"
          aria-label="Search logs"
        />
      </div>
      {chips.length > 0 && (
        <p>
          {chips.map((chip) => (
            <span key={chip} className="logs-context-chip">
              {chip}
            </span>
          ))}
        </p>
      )}
      {error && <p className="evidence-error">Logs error: {error}</p>}
      {items.length === 0 ? (
        <p className="empty-state">No log entries match the current filters.</p>
      ) : (
        <>
          <table className="logs-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Level</th>
                <th>Phase</th>
                <th>Event</th>
                <th>Message</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const detailsText = formatDetails(item.detailsJson);
                return (
                  <tr key={item.id}>
                    <td>{item.timestamp}</td>
                    <td>
                      <span className={`log-level-${item.level}`}>{item.level}</span>
                    </td>
                    <td>{item.phase}</td>
                    <td>{item.eventType}</td>
                    <td>{item.message}</td>
                    <td className="log-details">
                      {detailsText ? (
                        <details>
                          <summary>
                            view
                            {item.redacted && <span className="log-redacted-label">redacted</span>}
                          </summary>
                          <pre>{detailsText}</pre>
                        </details>
                      ) : (
                        <span className="log-redacted-label">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {hasMore && (
            <button className="logs-load-more" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function formatDetails(detailsJson: string | null): string | null {
  if (!detailsJson) return null;
  try {
    const parsed = JSON.parse(detailsJson) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return detailsJson;
  }
}
