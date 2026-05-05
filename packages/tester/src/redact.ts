/**
 * Redact secret/credential values from arbitrary input/output payloads before
 * persisting them as evidence.
 *
 * The strategy is conservative: we keep structural information (keys, types,
 * lengths) so reviewers can still see the *shape* of the call, but we replace
 * any value whose key looks credential-like with a placeholder.
 */
const SECRET_KEY_RE =
  /(secret|password|token|credential|api[_-]?key|authorization|cookie|private[_-]?key)/i;

const PLACEHOLDER = '[redacted]';

export function redactValue(value: unknown, keyName?: string): unknown {
  if (value === null || value === undefined) return value;

  if (keyName && SECRET_KEY_RE.test(keyName)) {
    if (typeof value === 'string') return `${PLACEHOLDER}<len=${value.length}>`;
    return PLACEHOLDER;
  }

  if (typeof value === 'string') {
    // Mask anything that looks like a JWT, bearer token, or AWS-style key.
    if (/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(value)) {
      return `${PLACEHOLDER}<jwt,len=${value.length}>`;
    }
    if (/(AKIA|ASIA)[A-Z0-9]{12,}/.test(value)) {
      return `${PLACEHOLDER}<aws_key>`;
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(v, k);
    }
    return out;
  }

  return value;
}

export function redactRecord(input: Record<string, unknown>): Record<string, unknown> {
  return redactValue(input) as Record<string, unknown>;
}
