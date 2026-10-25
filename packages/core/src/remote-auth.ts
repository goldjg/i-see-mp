import { RemoteAuthSchema, type RemoteAuth } from './schemas.js';

export interface RemoteAuthConfig {
  auth?: RemoteAuth;
  env?: Record<string, string>;
}

const MAX_AUTHORIZATION_LENGTH = 8192;

/**
 * Resolve credentials only at connection time. This fetch is private to one
 * transport, including its SSE GETs, POSTs, and reconnects.
 */
export function remoteRequestOptions(url: URL, config: RemoteAuthConfig): { fetch?: typeof fetch } {
  let authorization: string | undefined;
  if (config.auth !== undefined) {
    const parsed = RemoteAuthSchema.safeParse(config.auth);
    if (!parsed.success) throw new Error('Invalid remote auth.envVar reference');
    const token = process.env[parsed.data.envVar];
    if (!token?.trim()) {
      throw new Error(`Missing or empty credential environment variable: ${parsed.data.envVar}`);
    }
    if (!/^[A-Za-z0-9._~+/-]+=*$/.test(token)) {
      throw new Error('Invalid bearer credential in auth.envVar');
    }
    authorization = `Bearer ${token}`;
  } else {
    // Preserve explicitly server-scoped legacy credentials, never ambient ones.
    authorization = config.env?.Authorization;
    const token = config.env?.GITHUB_PERSONAL_ACCESS_TOKEN;
    if (!authorization && token) authorization = `Bearer ${token}`;
  }
  if (authorization === undefined) return {};
  if (
    !authorization.trim() ||
    /[\r\n]/.test(authorization) ||
    authorization.includes('[redacted]') ||
    authorization.length > MAX_AUTHORIZATION_LENGTH
  ) {
    throw new Error('Invalid explicit remote Authorization credential');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Credential-bearing MCP connections require an HTTP(S) URL without userinfo');
  }

  // Include the bare secret so a server cannot leak it through an error or tool response.
  const secret = authorization.slice(authorization.indexOf(' ') + 1);
  const sensitive = [
    ...new Set(
      [authorization, secret].flatMap((value) => [JSON.stringify(value).slice(1, -1), value]),
    ),
  ]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const origin = url.origin;
  const header = authorization;

  return {
    fetch: async (input, init) => {
      const target = new URL(input instanceof Request ? input.url : input);
      if (target.origin !== origin || target.username || target.password) {
        throw new Error('Blocked credential-bearing MCP request outside the configured origin');
      }
      let response: Response;
      try {
        const headers = new Headers(
          init?.headers ?? (input instanceof Request ? input.headers : undefined),
        );
        headers.set('Authorization', header);
        response = await fetch(input, { ...init, headers, redirect: 'manual' });
      } catch {
        // Native header/network errors can contain request details; do not retain a cause.
        throw new Error('Credential-bearing MCP request failed');
      }
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new Error(
          'Blocked redirect for credential-bearing MCP request; configure the final URL',
        );
      }
      const headers = new Headers(response.headers);
      for (const [key, value] of headers) {
        headers.set(
          key,
          sensitive.reduce((text, secret) => text.split(secret).join('[redacted]'), value),
        );
      }
      if (!response.body) return new Response(null, { status: response.status, headers });

      // Retain only a possible secret prefix, not SSE event delimiters.
      let pending = '';
      const redact = (flush: boolean): string => {
        let output = '';
        let offset = 0;
        while (offset < pending.length) {
          const match = sensitive.find((value) => pending.startsWith(value, offset));
          if (
            !match &&
            !flush &&
            sensitive.some((value) => value.startsWith(pending.slice(offset)))
          )
            break;
          output += match ? '[redacted]' : pending[offset];
          offset += match?.length ?? 1;
        }
        pending = pending.slice(offset);
        return output;
      };
      const body = response.body
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(
          new TransformStream<string, string>({
            transform(chunk, controller) {
              pending += chunk;
              controller.enqueue(redact(false));
            },
            flush(controller) {
              controller.enqueue(redact(true));
            },
          }),
        )
        .pipeThrough(new TextEncoderStream());
      headers.delete('content-length');
      headers.delete('content-encoding');
      return new Response(body, { status: response.status, headers });
    },
  };
}
