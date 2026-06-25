/** @vitest-environment jsdom */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Finding, Tool } from '../../api.js';
import {
  ClassificationEvidenceSection,
  getAffectedToolIds,
} from '../Findings.js';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f-1',
    collectionId: 'c-1',
    category: 'DATA_EXFILTRATION',
    severity: 'high',
    title: 'finding',
    description: 'desc',
    affectedNodeIds: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeTool(overrides: Partial<Tool> = {}): Tool {
  return {
    id: 'tool-a',
    collectionId: 'c-1',
    serverId: 's-1',
    name: 'My Tool',
    description: null,
    capabilities: [],
    sourceRole: [],
    isUntrusted: false,
    isInstructionCapable: false,
    contentOrigin: 'local',
    riskScore: 0,
    ...overrides,
  };
}

describe('getAffectedToolIds', () => {
  it('extracts tool IDs from tool: prefixed node IDs', () => {
    expect(getAffectedToolIds(['tool:abc', 'tool:def', 'server:xyz'])).toEqual(['abc', 'def']);
  });

  it('returns empty array when no tool: nodes present', () => {
    expect(getAffectedToolIds(['server:x', 'resource:y'])).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    expect(getAffectedToolIds([])).toEqual([]);
  });
});

describe('ClassificationEvidenceSection', () => {
  it('renders evidence table for affected tools with classification evidence', () => {
    const tool = makeTool({
      id: 'tool-a',
      name: 'File Reader',
      classificationEvidence: [
        {
          capability: 'READ_FILE',
          source: 'name',
          matched: 'read_file',
          reason: 'Tool name matches file-read pattern',
        },
      ],
    });
    const toolsById = new Map([['tool-a', tool]]);
    const finding = makeFinding({ affectedNodeIds: ['tool:tool-a'] });

    render(<ClassificationEvidenceSection finding={finding} toolsById={toolsById} />);

    // Summary element present
    expect(screen.getByText('Why these tools were classified this way')).toBeTruthy();

    // Tool name shown
    expect(screen.getByText('File Reader')).toBeTruthy();

    // Evidence row values shown
    expect(screen.getByText('READ_FILE')).toBeTruthy();
    expect(screen.getByText('name')).toBeTruthy();
    expect(screen.getByText('read_file')).toBeTruthy();
    expect(screen.getByText('Tool name matches file-read pattern')).toBeTruthy();
  });

  it('shows muted message when affected tools have no classification evidence', () => {
    const tool = makeTool({ id: 'tool-a', classificationEvidence: undefined });
    const toolsById = new Map([['tool-a', tool]]);
    const finding = makeFinding({ affectedNodeIds: ['tool:tool-a'] });

    render(<ClassificationEvidenceSection finding={finding} toolsById={toolsById} />);

    expect(screen.getByText(/No classification evidence recorded for affected tools/i)).toBeTruthy();
  });

  it('does not crash when classificationEvidence is empty array', () => {
    const tool = makeTool({ id: 'tool-a', classificationEvidence: [] });
    const toolsById = new Map([['tool-a', tool]]);
    const finding = makeFinding({ affectedNodeIds: ['tool:tool-a'] });

    const { container } = render(
      <ClassificationEvidenceSection finding={finding} toolsById={toolsById} />,
    );

    // No details element rendered since no evidence rows
    expect(container.querySelector('.classification-evidence-details')).toBeNull();
  });

  it('renders nothing when no affected tool: nodes are present', () => {
    const tool = makeTool({ id: 'tool-a' });
    const toolsById = new Map([['tool-a', tool]]);
    const finding = makeFinding({ affectedNodeIds: ['server:s-1'] });

    const { container } = render(
      <ClassificationEvidenceSection finding={finding} toolsById={toolsById} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('does not show evidence for unrelated tools not in affectedNodeIds', () => {
    const relatedTool = makeTool({
      id: 'tool-a',
      name: 'Related Tool',
      classificationEvidence: [
        { capability: 'SEND_EXTERNAL', source: 'description', matched: 'send', reason: 'sends data' },
      ],
    });
    const unrelatedTool = makeTool({
      id: 'tool-b',
      name: 'Unrelated Tool',
      classificationEvidence: [
        { capability: 'READ_FILE', source: 'name', matched: 'read', reason: 'reads files' },
      ],
    });
    const toolsById = new Map([
      ['tool-a', relatedTool],
      ['tool-b', unrelatedTool],
    ]);
    // Only tool-a is in affectedNodeIds
    const finding = makeFinding({ affectedNodeIds: ['tool:tool-a'] });

    render(<ClassificationEvidenceSection finding={finding} toolsById={toolsById} />);

    expect(screen.getByText('Related Tool')).toBeTruthy();
    expect(screen.queryByText('Unrelated Tool')).toBeNull();
  });

  it('handles toolsById lookup miss gracefully', () => {
    const toolsById = new Map<string, Tool>();
    const finding = makeFinding({ affectedNodeIds: ['tool:missing-id'] });

    // Should not throw
    const { container } = render(
      <ClassificationEvidenceSection finding={finding} toolsById={toolsById} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
