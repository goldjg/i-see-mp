import React, { useState, useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import { api } from '../api.js';
import type { GraphNode, GraphEdge } from '../api.js';

const NODE_COLORS: Record<string, string> = {
  agent: '#fbbf24',
  mcp_server: '#3b82f6',
  tool: '#22c55e',
  resource: '#14b8a6',
  prompt: '#a855f7',
  data_source: '#f97316',
  external_system: '#8b5cf6',
  trust_boundary: '#f97316',
  sensitive_data: '#ef4444',
  context_source: '#64748b',
};

const NODE_SHAPES: Record<string, string> = {
  agent: 'diamond',
  mcp_server: 'rectangle',
  tool: 'roundrectangle',
  resource: 'ellipse',
  sensitive_data: 'star',
  trust_boundary: 'rectangle',
  external_system: 'rectangle',
};

export function Graph({ onSelectNode }: { onSelectNode?: (nodeId: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [filterType, setFilterType] = useState<string>('');
  const [filterCap, setFilterCap] = useState<string>('');

  useEffect(() => {
    async function load() {
      try {
        const cols = await api.collections();
        if (!cols[0]) return;
        const g = await api.graph(cols[0].id);
        setNodes(g.nodes);
        setEdges(g.edges);
      } catch (e) {
        console.error(e);
      }
    }
    void load();
  }, []);

  useEffect(() => {
    if (!containerRef.current || nodes.length === 0) return;

    const filteredNodes = nodes.filter((n) => {
      if (filterType && n.type !== filterType) return false;
      if (filterCap && !n.capabilities.includes(filterCap)) return false;
      return true;
    });
    const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
    const filteredEdges = edges.filter(
      (e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target),
    );

    const cy = cytoscape({
      container: containerRef.current,
      elements: [
        ...filteredNodes.map((n) => ({
          data: {
            id: n.id,
            label: n.label,
            type: n.type,
            riskScore: n.riskScore,
          },
        })),
        ...filteredEdges.map((e) => ({
          data: { id: e.id, source: e.source, target: e.target, type: e.type },
        })),
      ],
      style: [
        {
          selector: 'node',
          style: {
            'background-color': (ele: cytoscape.NodeSingular) => NODE_COLORS[ele.data('type') as string] ?? '#94a3b8',
            'label': 'data(label)',
            'color': '#fff',
            'text-outline-color': '#1e293b',
            'text-outline-width': 2,
            'font-size': 10,
            'shape': (ele: cytoscape.NodeSingular) => (NODE_SHAPES[ele.data('type') as string] ?? 'ellipse') as cytoscape.Css.NodeShape,
            'width': (ele: cytoscape.NodeSingular) => Math.max(40, (ele.data('riskScore') as number) * 0.6),
            'height': (ele: cytoscape.NodeSingular) => Math.max(30, (ele.data('riskScore') as number) * 0.4),
          },
        },
        {
          selector: 'edge',
          style: {
            'label': 'data(type)',
            'font-size': 8,
            'color': '#94a3b8',
            'text-outline-width': 0,
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'line-color': '#475569',
            'target-arrow-color': '#475569',
            'width': 1,
          },
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 3,
            'border-color': '#f59e0b',
          },
        },
      ],
      layout: { name: 'cose', animate: false, randomize: false } as cytoscape.LayoutOptions,
    });

    cy.on('tap', 'node', (evt) => {
      const nodeId = evt.target.id() as string;
      const node = nodes.find((n) => n.id === nodeId) ?? null;
      setSelected(node);
      onSelectNode?.(nodeId);
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [nodes, edges, filterType, filterCap, onSelectNode]);

  const allTypes = [...new Set(nodes.map((n) => n.type))];
  const allCaps = [...new Set(nodes.flatMap((n) => n.capabilities))];

  return (
    <div className="graph-view">
      <div className="graph-filters">
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          <option value="">All types</option>
          {allTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filterCap} onChange={(e) => setFilterCap(e.target.value)}>
          <option value="">All capabilities</option>
          {allCaps.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={() => { setFilterType(''); setFilterCap(''); }}>Reset filters</button>
      </div>
      <div className="graph-container">
        <div ref={containerRef} className="cytoscape-canvas" />
        {selected && (
          <div className="node-detail-panel">
            <h3>{selected.label}</h3>
            <p><strong>Type:</strong> {selected.type}</p>
            <p><strong>Risk Score:</strong> {selected.riskScore}</p>
            {selected.capabilities.length > 0 && (
              <p><strong>Capabilities:</strong> {selected.capabilities.join(', ')}</p>
            )}
            <button onClick={() => setSelected(null)}>✕ Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
