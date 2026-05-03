/** @vitest-environment jsdom */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Graph } from '../Graph.js';

let latestConfig: { elements: Array<{ data: Record<string, unknown> }> } | null = null;

vi.mock('cytoscape', () => ({
  default: vi.fn((config: { elements: Array<{ data: Record<string, unknown> }> }) => {
    latestConfig = config;
    return {
      on: vi.fn(),
      destroy: vi.fn(),
      zoom: vi.fn(() => 1),
      minZoom: vi.fn(() => 0.2),
      maxZoom: vi.fn(() => 2.5),
      width: vi.fn(() => 1000),
      height: vi.fn(() => 700),
      fit: vi.fn(),
      center: vi.fn(),
    };
  }),
}));

vi.mock('../../api.js', () => ({
  api: {
    collections: vi.fn(async () => [{ id: 'col-1' }]),
    graph: vi.fn(async () => ({
      nodes: [
        { id: 'node-a', type: 'tool', label: 'Node A', capabilities: [], riskScore: 10 },
        { id: 'node-b', type: 'resource', label: 'Node B', capabilities: [], riskScore: 9 },
      ],
      edges: [{ id: 'edge-a', source: 'node-a', target: 'node-b', type: 'connects' }],
    })),
  },
}));

describe('Graph trifecta filter controls', () => {
  beforeEach(() => {
    latestConfig = null;
  });

  it('renders trifecta filter options', () => {
    render(
      <Graph
        trifectaNodeIds={new Set(['node-a'])}
        completeNodeIds={new Set(['node-a'])}
      />,
    );

    expect(screen.getByRole('option', { name: 'All nodes' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Trifecta paths (complete + partial)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Complete paths only' })).toBeTruthy();
  });

  it('defaults trifecta filter to all', () => {
    const { container } = render(
      <Graph
        trifectaNodeIds={new Set(['node-a'])}
        completeNodeIds={new Set(['node-a'])}
      />,
    );
    const select = container.querySelector('.graph-trifecta-filter') as HTMLSelectElement;
    expect(select.value).toBe('all');
  });

  it('keeps all graph nodes when trifecta filter is all', async () => {
    render(
      <Graph
        trifectaNodeIds={new Set(['node-a'])}
        completeNodeIds={new Set(['node-a'])}
      />,
    );

    await waitFor(() => {
      expect(latestConfig).toBeTruthy();
    });
    const elements = latestConfig?.elements ?? [];
    const nodeCount = elements.filter((el) => !('source' in el.data)).length;
    expect(nodeCount).toBe(2);
  });

  it('reset filters clears trifecta filter back to all', () => {
    const { container } = render(
      <Graph
        trifectaNodeIds={new Set(['node-a'])}
        completeNodeIds={new Set(['node-a'])}
      />,
    );

    const select = container.querySelector('.graph-trifecta-filter') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'trifecta' } });
    expect(select.value).toBe('trifecta');

    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(select.value).toBe('all');
  });

  it('shows empty-set status when trifecta filter is enabled with no trifecta findings', () => {
    const { container } = render(
      <Graph
        trifectaNodeIds={new Set()}
        completeNodeIds={new Set()}
      />,
    );

    const select = container.querySelector('.graph-trifecta-filter') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'trifecta' } });
    expect(screen.getByText(/No trifecta findings/i)).toBeTruthy();
  });
});
