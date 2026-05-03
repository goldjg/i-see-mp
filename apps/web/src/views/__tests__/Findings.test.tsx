/** @vitest-environment jsdom */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Finding } from '../../api.js';
import { FindingBadges, TrifectaExplanation, TrifectaLegend } from '../Findings.js';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f-1',
    collectionId: 'c-1',
    category: 'DATA_EXFILTRATION',
    severity: 'high',
    title: 'finding',
    description: 'desc',
    affectedNodeIds: ['node-a'],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('Trifecta explanation and legend UI', () => {
  it('renders trifecta explanation wording for COMPLETE findings', () => {
    render(
      <TrifectaExplanation
        finding={makeFinding({
          trifectaStage: 'COMPLETE',
          sourceCapabilities: ['READ_SECRET_HIGH'],
          sinkCapabilities: ['SEND_EXTERNAL'],
        })}
      />,
    );
    expect(screen.getByText(/structural source-to-sink path/i)).toBeTruthy();
  });

  it('renders trifecta explanation wording for PARTIAL findings', () => {
    render(
      <TrifectaExplanation
        finding={makeFinding({
          trifectaStage: 'PARTIAL',
          sourceCapabilities: ['READ_SECRET_HIGH'],
        })}
      />,
    );
    expect(screen.getByText(/full structural source-to-sink chain is not present/i)).toBeTruthy();
  });

  it('renders trifecta explanation wording for CAPABILITY_ONLY findings', () => {
    render(
      <TrifectaExplanation
        finding={makeFinding({
          trifectaStage: 'CAPABILITY_ONLY',
        })}
      />,
    );
    expect(screen.getByText(/standalone exposed capability/i)).toBeTruthy();
  });

  it('does not render trifecta explanation when trifecta metadata is absent', () => {
    const { container } = render(
      <TrifectaExplanation
        finding={makeFinding({
          trifectaStage: undefined,
        })}
      />,
    );
    expect(container.querySelector('.trifecta-explanation')).toBeNull();
  });

  it('renders "not present" for missing source/sink capabilities', () => {
    render(
      <TrifectaExplanation
        finding={makeFinding({
          trifectaStage: 'COMPLETE',
        })}
      />,
    );
    const notPresent = screen.getAllByText('not present');
    expect(notPresent.length).toBe(2);
  });

  it('renders cross-server path label and server pair when cross-server metadata exists', () => {
    render(
      <TrifectaExplanation
        finding={makeFinding({
          trifectaStage: 'PARTIAL',
          isCrossServer: true,
          sourceServerId: 'filesystem',
          sinkServerId: 'fetch',
        })}
      />,
    );
    expect(screen.getByText('Cross-server path candidate')).toBeTruthy();
    expect(screen.getByText('filesystem → fetch')).toBeTruthy();
  });

  it('renders trust transition and crossed state when trust metadata exists', () => {
    render(
      <TrifectaExplanation
        finding={makeFinding({
          trifectaStage: 'PARTIAL',
          isCrossServer: true,
          sourceServerId: 'filesystem',
          sinkServerId: 'github',
          trustTransition: 'LOCAL → EXTERNAL',
          crossesTrustBoundary: true,
        })}
      />,
    );
    expect(screen.getByText('LOCAL → EXTERNAL')).toBeTruthy();
    expect(screen.getByText('Crossed')).toBeTruthy();
  });

  it('renders COMPLETE badge tooltip text', () => {
    render(<FindingBadges finding={makeFinding({ trifectaStage: 'COMPLETE' })} />);
    const badge = screen.getByText('TRIFECTA_COMPLETE');
    expect(badge.getAttribute('title')).toContain('Structural dataflow complete');
  });

  it('renders PARTIAL badge tooltip text', () => {
    render(<FindingBadges finding={makeFinding({ trifectaStage: 'PARTIAL' })} />);
    const badge = screen.getByText('TRIFECTA_PARTIAL');
    expect(badge.getAttribute('title')).toContain('Structural dataflow partial');
  });

  it('renders CAPABILITY_ONLY badge tooltip text', () => {
    render(<FindingBadges finding={makeFinding({ trifectaStage: 'CAPABILITY_ONLY' })} />);
    const badge = screen.getByText('CAPABILITY_ONLY');
    expect(badge.getAttribute('title')).toContain('Not part of a detected');
  });

  it('renders trust-boundary badge when crossing trust tiers', () => {
    render(
      <FindingBadges
        finding={makeFinding({
          isCrossServer: true,
          crossesTrustBoundary: true,
        })}
      />,
    );
    expect(screen.getByText('TRUST_BOUNDARY')).toBeTruthy();
  });

  it('renders cross-server badge when not crossing trust tiers', () => {
    render(
      <FindingBadges
        finding={makeFinding({
          isCrossServer: true,
          crossesTrustBoundary: false,
        })}
      />,
    );
    expect(screen.getByText('CROSS_SERVER')).toBeTruthy();
  });

  it('renders trifecta legend rows', () => {
    render(<TrifectaLegend />);
    expect(screen.getByText('TRIFECTA_COMPLETE')).toBeTruthy();
    expect(screen.getByText('TRIFECTA_PARTIAL')).toBeTruthy();
    expect(screen.getByText('CAPABILITY_ONLY')).toBeTruthy();
    expect(screen.getByText('LETHAL_TRIFECTA_POSSIBLE')).toBeTruthy();
  });

  it('renders lethal trifecta candidate badge', () => {
    render(<FindingBadges finding={makeFinding({ lethalTrifectaStatus: 'POSSIBLE' })} />);
    const badge = screen.getByText('LETHAL_TRIFECTA_POSSIBLE');
    expect(badge.getAttribute('title')).toContain('candidate path');
  });
});
