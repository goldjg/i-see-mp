import { StdioEnvConfigSchema } from './schemas.js';

export interface StdioEnvConfig {
  env?: Record<string, string>;
  envRefs?: Record<string, string>;
}

/** The MCP SDK adds platform runtime defaults; never supply ambient process.env. */
export function stdioEnvironment(config: StdioEnvConfig): {
  env: Record<string, string>;
  redact: (value: unknown) => unknown;
} {
  const parsed = StdioEnvConfigSchema.safeParse(config);
  if (!parsed.success) throw new Error('Invalid stdio env or envRefs configuration');
  const entries = new Map(Object.entries(parsed.data.env ?? {}));
  for (const [name, reference] of Object.entries(parsed.data.envRefs ?? {})) {
    const value = Object.hasOwn(process.env, reference) ? process.env[reference] : undefined;
    if (typeof value !== 'string' || value === '') {
      throw new Error('Missing or empty stdio envRefs environment variable');
    }
    if (value.includes('\0')) throw new Error('Invalid stdio envRefs environment value');
    entries.set(name, value);
  }
  if (process.platform === 'win32') {
    const names = [...entries.keys()].map((name) => name.toUpperCase());
    if (new Set(names).size !== names.length) {
      throw new Error('Conflicting case-insensitive stdio environment names');
    }
  }
  // Treat all explicit values as sensitive, rather than guessing from variable names.
  const values = [...new Set(entries.values())].filter(Boolean).sort((a, b) => b.length - a.length);
  const redact = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return values.reduce((text, secret) => text.split(secret).join('[redacted]'), value);
    }
    if (Array.isArray(value)) return value.map(redact);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [String(redact(key)), redact(item)]),
      );
    }
    return value;
  };
  console.warn(
    'Stdio environment policy: SDK runtime defaults and explicit env/envRefs only; ambient variables are not inherited. Use envRefs for collect/test replay.',
  );
  return {
    env: Object.fromEntries(
      [...entries].map(([name, value]) => [
        process.platform === 'win32' ? name.toUpperCase() : name,
        value,
      ]),
    ),
    redact,
  };
}
