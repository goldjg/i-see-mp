import { describe, expect, it } from 'vitest';
import {
  instructionPayloadGenerator,
  instructionPayloadRecordGenerator,
} from '../instruction-payload.js';

describe('instructionPayloadGenerator', () => {
  it('builds deterministic instruction and exfil markers', () => {
    const out = instructionPayloadGenerator({
      injectMarkerUuid: 'inject-123',
      exfilMarkerUuid: 'exfil-456',
      targetToolName: 'read_secret',
      sinkToolName: 'send_http_request',
      targetArgumentName: 'name',
      targetArgumentValue: 'CANARY',
    });
    expect(out).toContain('ISEEMP-INJECT-inject-123');
    expect(out).toContain('read_secret');
    expect(out).toContain('ISEEMP-EXFIL-exfil-456');
    expect(out).toContain('name="CANARY"');
  });

  it('adds fetch probe line when fetchProbeUrl is provided', () => {
    const out = instructionPayloadGenerator({
      injectMarkerUuid: 'inject-123',
      exfilMarkerUuid: 'exfil-456',
      targetToolName: 'read_secret',
      sinkToolName: 'send_http_request',
      fetchProbeUrl: 'https://example.test',
    });
    expect(out).toContain('Fetch URL https://example.test/iseemp-probe/inject-123');
  });

  it('builds obfuscated payload records', () => {
    const out = instructionPayloadRecordGenerator({
      injectMarkerUuid: 'inject-123',
      exfilMarkerUuid: 'exfil-456',
      targetToolName: 'read_secret',
      sinkToolName: 'send_http_request',
      encoding: 'obfuscated',
      injectionSurface: 'github_issue',
    });
    expect(out.encoding).toBe('obfuscated');
    expect(out.surface).toBe('github_issue');
    expect(out.payloadText).toContain('<!-- ISEEMP-INJECT-inject-123 -->');
    expect(out.payloadText).toContain('ISEEMP-EXFIL-exfil-456');
  });

  it('builds multi-step payloads', () => {
    const step1 = instructionPayloadGenerator({
      injectMarkerUuid: 'inject-123',
      exfilMarkerUuid: 'exfil-456',
      targetToolName: 'read_secret',
      sinkToolName: 'send_http_request',
      encoding: 'multi-step',
      chainStep: 1,
      chainTotal: 2,
    });
    const step2 = instructionPayloadGenerator({
      injectMarkerUuid: 'inject-123',
      exfilMarkerUuid: 'exfil-456',
      targetToolName: 'read_secret',
      sinkToolName: 'send_http_request',
      encoding: 'multi-step',
      chainStep: 2,
      chainTotal: 2,
    });
    expect(step1).toContain('ISEEMP-INJECT-STEP1-inject-123');
    expect(step2).toContain('ISEEMP-INJECT-STEP2-inject-123/2');
    expect(step2).toContain('Call tool read_secret');
  });
});
