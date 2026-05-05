import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { createLogsRepo } from './repos/logs.js';

export interface LogEntry {
  level: 'info' | 'warn' | 'error';
  phase: 'collect' | 'analyze' | 'test' | 'serve' | 'demo';
  collectionId?: string;
  serverId?: string;
  toolId?: string;
  findingId?: string;
  testRunId?: string;
  eventType: string;
  message: string;
  details?: Record<string, unknown>;
}

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY_RE =
  /(token|secret|password|authorization|cookie|bearer|pat|credential|api[_-]?key|access[_-]?token|refresh[_-]?token|github[_-]?token|private[_-]?key)/i;
const BASE64_RE = /^[A-Za-z0-9+/=]{48,}$/;

function redactString(value: string): { value: string; redacted: boolean } {
  const original = value;
  let out = value;
  out = out.replace(/ghp_[A-Za-z0-9_]+/gi, REDACTED);
  out = out.replace(/ghs_[A-Za-z0-9_]+/gi, REDACTED);
  out = out.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, REDACTED);
  out = out.replace(/bearer\s+[A-Za-z0-9._~-]+/gi, `bearer ${REDACTED}`);
  out = out.replace(/\bauthorization\s*:\s*[^\s,;]+/gi, `authorization: ${REDACTED}`);
  out = out.replace(/\bcookie\s*:\s*[^\s,;]+/gi, `cookie: ${REDACTED}`);
  return { value: out, redacted: out !== original };
}

function redact(details: Record<string, unknown> | undefined): {
  details: Record<string, unknown> | undefined;
  redacted: boolean;
} {
  if (!details) return { details: undefined, redacted: false };

  let anyRedacted = false;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(details)) {
    const keySensitive = SENSITIVE_KEY_RE.test(key) || key.toLowerCase() === 'key';
    if (keySensitive) {
      out[key] = REDACTED;
      anyRedacted = true;
      continue;
    }

    if (typeof value === 'string') {
      if (
        BASE64_RE.test(value) &&
        /auth|token|secret|key|cookie|credential|pat|bearer/i.test(key)
      ) {
        out[key] = REDACTED;
        anyRedacted = true;
        continue;
      }
      const redactedString = redactString(value);
      out[key] = redactedString.value;
      if (redactedString.redacted) {
        anyRedacted = true;
      }
      continue;
    }

    out[key] = value;
  }

  return { details: out, redacted: anyRedacted };
}

export function log(db: Database.Database, entry: LogEntry): void {
  try {
    const { details, redacted } = redact(entry.details);
    const message = redactString(entry.message);
    createLogsRepo(db).insert({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      level: entry.level,
      phase: entry.phase,
      collection_id: entry.collectionId ?? null,
      server_id: entry.serverId ?? null,
      tool_id: entry.toolId ?? null,
      finding_id: entry.findingId ?? null,
      test_run_id: entry.testRunId ?? null,
      event_type: entry.eventType,
      message: message.value,
      details_json: details ? JSON.stringify(details) : null,
      redacted: redacted || message.redacted ? 1 : 0,
    });
  } catch (err) {
    // additive diagnostics must not fail callers
    const reason = err instanceof Error ? err.name : 'unknown';
    console.error(`ISeeMP diagnostic log persistence failed (${reason})`);
  }
}
