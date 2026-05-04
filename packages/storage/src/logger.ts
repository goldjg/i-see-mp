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
  /(token|key|secret|password|authorization|cookie|bearer|pat|credential|api[_-]?key|access[_-]?token|refresh[_-]?token|gh_|github[_-]?token)/i;
const SENSITIVE_VALUE_RE = /(ghp_[A-Za-z0-9_]+|ghs_[A-Za-z0-9_]+|bearer\s+[A-Za-z0-9._~-]+|authorization:|cookie:)/i;
const BASE64_RE = /^[A-Za-z0-9+/=]{64,}$/;

function redact(details: Record<string, unknown> | undefined): {
  details: Record<string, unknown> | undefined;
  redacted: boolean;
} {
  if (!details) return { details: undefined, redacted: false };

  let anyRedacted = false;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(details)) {
    const keySensitive = SENSITIVE_KEY_RE.test(key);
    if (keySensitive) {
      out[key] = REDACTED;
      anyRedacted = true;
      continue;
    }

    if (typeof value === 'string') {
      if (SENSITIVE_VALUE_RE.test(value)) {
        out[key] = REDACTED;
        anyRedacted = true;
        continue;
      }
      if (BASE64_RE.test(value) && /auth|token|secret|key|cookie|credential/i.test(key)) {
        out[key] = REDACTED;
        anyRedacted = true;
        continue;
      }
      out[key] = value;
      continue;
    }

    out[key] = value;
  }

  return { details: out, redacted: anyRedacted };
}

export function log(db: Database.Database, entry: LogEntry): void {
  try {
    const { details, redacted } = redact(entry.details);
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
      message: entry.message,
      details_json: details ? JSON.stringify(details) : null,
      redacted: redacted ? 1 : 0,
    });
  } catch {
    // additive diagnostics must not fail callers
    console.error('ISeeMP diagnostic log persistence failed');
  }
}
