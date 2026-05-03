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

type TrifectaFilter = 'all' | 'trifecta' | 'complete_only';

export function Graph({
  onSelectNode,
  trifectaNodeIds,
  completeNodeIds,
}: {
  onSelectNode?: (nodeId: string) => void;
  trifectaNodeIds?: Set<string>;
  completeNodeIds?: Set<string>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [filterType, setFilterType] = useState<string>('');
  const [filterCap, setFilterCap] = useState<string>('');
  const [trifectaFilter, setTrifectaFilter] = useState<TrifectaFilter>('all');

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
    const activeNodeIds =
      trifectaFilter === 'trifecta'
        ? (trifectaNodeIds ?? new Set<string>())
        : trifectaFilter === 'complete_only'
          ? (completeNodeIds ?? new Set<string>())
          : new Set<string>();
    const hasTrifectaFocus = trifectaFilter !== 'all' && activeNodeIds.size > 0;

    const cy = cytoscape({
      container: containerRef.current,
      elements: [
        ...filteredNodes.map((n) => ({
          data: {
            id: n.id,
            label: n.label,
            type: n.type,
            riskScore: n.riskScore,
            trifectaActive: hasTrifectaFocus ? (activeNodeIds.has(n.id) ? 1 : 0) : 1,
          },
        })),
        ...filteredEdges.map((e) => ({
          data: {
            id: e.id,
            source: e.source,
            target: e.target,
            type: e.type,
            trifectaActive: hasTrifectaFocus && (activeNodeIds.has(e.source) || activeNodeIds.has(e.target))
              ? 1
              : hasTrifectaFocus
                ? 0
                : 1,
          },
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
            'text-wrap': 'wrap',
            'text-max-width': '110px',
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
          selector: 'edge[type = "carries_instruction"]',
          style: {
            'line-color': '#f97316',
            'target-arrow-color': '#f97316',
            'line-style': 'dashed',
            'width': 2,
          },
        },
        {
          selector: 'edge[type = "crosses_boundary"]',
          style: {
            'line-color': '#a855f7',
            'target-arrow-color': '#a855f7',
          },
        },
        {
          selector: 'edge[type = "observed_call"]',
          style: {
            'line-color': '#22c55e',
            'target-arrow-color': '#22c55e',
            'line-style': 'dashed',
            'width': 2,
          },
        },
        {
          selector: 'edge[type = "tested_path"]',
          style: {
            'line-color': '#0ea5e9',
            'target-arrow-color': '#0ea5e9',
            'line-style': 'dashed',
            'width': 2,
          },
        },
        ...(hasTrifectaFocus
          ? [
              {
                selector: 'node[trifectaActive = 0]',
                style: {
                  opacity: 0.15,
                },
              },
              {
                selector: 'edge[trifectaActive = 0]',
                style: {
                  opacity: 0.08,
                },
              },
              {
                selector: 'node[trifectaActive = 1]',
                style: {
                  'border-width': 2,
                  'border-color': '#f59e0b',
                },
              },
            ]
          : []),
        {
          selector: 'node:selected',
          style: {
            'border-width': 3,
            'border-color': '#f59e0b',
            opacity: 1,
          },
        },
      ],
      layout: {
        name: 'cose',
        animate: false,
        randomize: false,
        fit: true,
        padding: 70,
        nodeDimensionsIncludeLabels: true,
        nodeRepulsion: 12000,
        idealEdgeLength: 130,
        edgeElasticity: 80,
        gravity: 0.3,
      } as cytoscape.LayoutOptions,
      userZoomingEnabled: true,
      userPanningEnabled: true,
      minZoom: 0.2,
      maxZoom: 2.5,
      wheelSensitivity: 0.2,
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
  }, [nodes, edges, filterType, filterCap, trifectaFilter, trifectaNodeIds, completeNodeIds, onSelectNode]);

  const allTypes = [...new Set(nodes.map((n) => n.type))];
  const allCaps = [...new Set(nodes.flatMap((n) => n.capabilities))];
  const zoomBy = (factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    const next = cy.zoom() * factor;
    cy.zoom({
      level: Math.max(cy.minZoom(), Math.min(cy.maxZoom(), next)),
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    });
  };
  const resetView = () => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.fit(undefined, 70);
    cy.center();
  };

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
        <select
          className="graph-trifecta-filter"
          value={trifectaFilter}
          onChange={(e) => setTrifectaFilter(e.target.value as TrifectaFilter)}
        >
          <option value="all">All nodes</option>
          <option value="trifecta">Trifecta paths (complete + partial)</option>
          <option value="complete_only">Complete paths only</option>
        </select>
        <button onClick={() => { setFilterType(''); setFilterCap(''); setTrifectaFilter('all'); }}>Reset filters</button>
        <button onClick={() => zoomBy(1.2)}>Zoom in</button>
        <button onClick={() => zoomBy(1 / 1.2)}>Zoom out</button>
        <button onClick={resetView}>Reset view</button>
      </div>
      {trifectaFilter !== 'all' &&
        ((trifectaFilter === 'trifecta' && (trifectaNodeIds?.size ?? 0) === 0) ||
          (trifectaFilter === 'complete_only' && (completeNodeIds?.size ?? 0) === 0)) && (
          <p className="graph-trifecta-empty">No trifecta findings — filter has no effect.</p>
      )}
      <div className="graph-container">
        <div ref={containerRef} className="cytoscape-canvas" />
        <div className="graph-legend">
          <div><span className="legend-line legend-dataflow" /> Data exfiltration path</div>
          <div><span className="legend-line legend-instruction" /> Prompt injection candidate</div>
          <div><span className="legend-line legend-prompt-confirmed" /> Prompt injection confirmed</div>
          <div><span className="legend-line legend-trust" /> Trust boundary confirmed</div>
        </div>
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
