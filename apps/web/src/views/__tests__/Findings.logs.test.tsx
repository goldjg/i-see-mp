/** @vitest-environment jsdom */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Findings } from '../Findings.js';

vi.mock('../../api.js', () => ({
  api: {
    collections: vi.fn(async () => [{ id: 'col-1' }]),
    findings: vi.fn(async () => [
      {
        id: 'finding-1',
        collectionId: 'col-1',
        category: 'DATA_EXFILTRATION',
        severity: 'high',
        title: 'Finding one',
        description: 'Desc',
        affectedNodeIds: ['node-1'],
        createdAt: '2024-01-01T00:00:00.000Z',
        trifectaStage: 'COMPLETE',
        testRunIds: ['tr-1'],
      },
    ]),
    testRuns: vi.fn(async () => []),
    testRun: vi.fn(async () => {
      throw new Error('not used');
    }),
    evidence: vi.fn(async () => []),
  },
}));

describe('Findings logs integration', () => {
  it('calls onShowLogs with collection and test run context when available', async () => {
    const onShowLogs = vi.fn();
    render(<Findings onShowLogs={onShowLogs} />);

    await waitFor(() => {
      expect(screen.getByText('Finding one')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Finding one'));
    const showLogsButton = await screen.findByRole('button', { name: 'Show logs →' });
    fireEvent.click(showLogsButton);

    expect(onShowLogs).toHaveBeenCalledTimes(1);
    expect(onShowLogs).toHaveBeenCalledWith({
      collectionId: 'col-1',
      testRunId: 'tr-1',
    });
  });
});
