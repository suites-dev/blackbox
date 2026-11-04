import type { RequestEntry } from '../stimulus/summary.js';

/** What the Playwright request context sends on every call, beside what each call names. */
export interface RequestDefaults {
  readonly extraHTTPHeaders: unknown;
  readonly userAgent: unknown;
  readonly httpCredentials: unknown;
  readonly storageState: unknown;
}

function lowercased(headers: unknown): Record<string, unknown> {
  return typeof headers === 'object' && headers !== null
    ? Object.fromEntries(
        Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
      )
    : {};
}

/** The request as sent: the context's user agent and default headers first, each call's own headers over them. */
export function withDefaultHeaders(entry: RequestEntry, defaults: RequestDefaults): RequestEntry {
  const agent = typeof defaults.userAgent === 'string' ? { 'user-agent': defaults.userAgent } : {};
  const inherited = { ...agent, ...lowercased(defaults.extraHTTPHeaders) };
  if (Object.keys(inherited).length === 0) {
    return entry;
  }
  const options = typeof entry.options === 'object' && entry.options !== null ? entry.options : {};
  const own = 'headers' in options ? options.headers : undefined;
  return {
    ...entry,
    options: {
      ...options,
      headers: { ...inherited, ...lowercased(own) },
    },
  };
}

/** Credentials and stored cookies shape every request but cannot be summarized: the stimulus is unestablished. */
export function hasUnrecordedDefaults(defaults: RequestDefaults): boolean {
  return defaults.httpCredentials !== undefined || defaults.storageState !== undefined;
}
