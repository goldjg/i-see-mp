import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

export interface RecordedRequest {
  receivedAt: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface MockSink {
  url: string;
  port: number;
  requests: RecordedRequest[];
  /** Returns true if any recorded request body contains `marker`. */
  observed(marker: string): boolean;
  close(): Promise<void>;
}

/**
 * Start a local-only HTTP server that records every request it receives. Used
 * by the deterministic tester to detect whether a "send_external" tool actually
 * received the canary payload — i.e. whether the path is exploitable.
 *
 * The server only listens on 127.0.0.1 and never makes outbound calls.
 */
export async function startMockSink(): Promise<MockSink> {
  const requests: RecordedRequest[] = [];

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers[k] = v;
        else if (Array.isArray(v)) headers[k] = v.join(',');
      }
      requests.push({
        receivedAt: new Date().toISOString(),
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers,
        body,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, recorded: true }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address() as AddressInfo | null;
  if (!addr || typeof addr !== 'object') {
    throw new Error('Mock sink failed to bind to a port');
  }
  const port = addr.port;
  const url = `http://127.0.0.1:${port}/canary-sink`;

  return {
    url,
    port,
    requests,
    observed(marker: string): boolean {
      return requests.some((r) => r.body.includes(marker));
    },
    async close(): Promise<void> {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}
