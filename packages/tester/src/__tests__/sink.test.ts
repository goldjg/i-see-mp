import { describe, it, expect } from 'vitest';
import { startMockSink } from '../sink.js';

describe('mock sink', () => {
  it('records POST bodies and detects markers', async () => {
    const sink = await startMockSink();
    try {
      const body = JSON.stringify({ value: 'CANARY-XYZ-12345' });
      const res = await fetch(sink.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      expect(res.ok).toBe(true);
      expect(sink.requests).toHaveLength(1);
      expect(sink.requests[0]?.body).toBe(body);
      expect(sink.observed('CANARY-XYZ-12345')).toBe(true);
      expect(sink.observed('CANARY-NOT-THERE')).toBe(false);
    } finally {
      await sink.close();
    }
  });

  it('binds to localhost only', async () => {
    const sink = await startMockSink();
    try {
      expect(sink.url.startsWith('http://127.0.0.1:')).toBe(true);
    } finally {
      await sink.close();
    }
  });

  it('serves registered golden inject payload markers', async () => {
    const sink = await startMockSink();
    try {
      sink.registerGoldenInject('abc-123', 'ISEEMP-EXFIL-abc-123');
      const res = await fetch(`${sink.url}/iseemp-golden-inject/abc-123`);
      expect(res.ok).toBe(true);
      const payload = await res.json();
      expect(payload.injectMarker).toBe('ISEEMP-INJECT-abc-123');
      expect(payload.exfilMarker).toBe('ISEEMP-EXFIL-abc-123');
    } finally {
      await sink.close();
    }
  });

  it('observed() matches markers in request url as well as body', async () => {
    const sink = await startMockSink();
    try {
      const marker = 'ISEEMP-EXFIL-url-marker';
      const res = await fetch(`${sink.url}?m=${encodeURIComponent(marker)}`);
      expect(res.ok).toBe(true);
      expect(sink.observed(marker)).toBe(true);
    } finally {
      await sink.close();
    }
  });
});
