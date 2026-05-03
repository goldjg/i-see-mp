import { describe, expect, it } from 'vitest';
import { instructionPayloadGenerator } from '../instruction-payload.js';

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
});
