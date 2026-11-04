import { digestBytes, digestOf, type Digest } from '../envelope/canonical.js';
import { isSecretEnvironmentName } from '../reporting/redaction/secret-environment.js';

/** What the test handed to the request fixture, before the sandbox entrypoint was resolved. */
export interface RequestEntry {
  readonly method: string;
  readonly url: string;
  readonly options: unknown;
}

export interface RecordedRequest {
  readonly method: string;
  readonly target: 'entrypoint' | 'other-origin';
  /** Scheme, host and port of a request to anything other than the entrypoint; `null` for the entrypoint. */
  readonly origin: string | null;
  readonly path: string;
  /** Digest of the sorted query pairs, or `null` when there are none. */
  readonly query: Digest | null;
  /** Digest of the request body, or `null` when there is none. */
  readonly body: Digest | null;
  readonly contentType: string | null;
  /** Header name to a digest of its value, or `secret` when the name marks a credential. */
  readonly headers: Readonly<Record<string, Digest | 'secret'>>;
}

export interface RecordedStimulus {
  readonly title: string;
  readonly requests: readonly RecordedRequest[];
}

// Added by the stimulus scope itself and different on every execution.
const propagationHeaders = new Set(['traceparent', 'tracestate', 'baggage']);

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Canonical digest where possible; any value that has no canonical form is hashed through JSON. */
function valueDigest(value: unknown): Digest {
  try {
    return digestOf(value);
  } catch {
    const text = JSON.stringify(value) as string | undefined;
    return digestBytes(text ?? 'undefined');
  }
}

/** The value as its JSON serialization sends it (a `Date` is its timestamp); `undefined` when it has none. */
function serialized(value: unknown): unknown {
  try {
    const text = JSON.stringify(value) as string | undefined;
    return text === undefined ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

function bodyDigest(options: Readonly<Record<string, unknown>>): Digest | null {
  for (const key of ['data', 'form', 'multipart']) {
    const value = options[key];
    if (value === undefined) {
      continue;
    }
    if (typeof value === 'string' || value instanceof Uint8Array) {
      // Text and bytes share one framing, so a string never equals the bytes of another string.
      const bytes = typeof value === 'string' ? Buffer.from(value) : value;
      return digestOf({
        [key]: { kind: typeof value === 'string' ? 'text' : 'bytes', digest: digestBytes(bytes) },
      });
    }
    const sent = key === 'multipart' ? value : serialized(value);
    return valueDigest({
      [key]: record(value) || Array.isArray(value) ? sent : JSON.stringify(value),
    });
  }
  return null;
}

function headerSummary(
  options: Readonly<Record<string, unknown>>,
): Record<string, Digest | 'secret'> {
  const headers = record(options.headers) ? options.headers : {};
  const entries: [string, Digest | 'secret'][] = [];
  for (const [rawName, value] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    if (propagationHeaders.has(name)) {
      continue;
    }
    entries.push([
      name,
      isSecretEnvironmentName(name)
        ? 'secret'
        : valueDigest(typeof value === 'string' ? value : JSON.stringify(value)),
    ]);
  }
  return Object.fromEntries(entries.sort(([left], [right]) => (left < right ? -1 : 1)));
}

/** The query the request carries: the URL's own pairs, then Playwright's `params` option applied over them. */
function queryPairs(parsed: URL, params: unknown): [string, string][] {
  const search = new URLSearchParams(parsed.search);
  const applied: Iterable<[string, string]> =
    params instanceof URLSearchParams
      ? params.entries()
      : typeof params === 'string'
        ? new URLSearchParams(params).entries()
        : record(params)
          ? Object.entries(params).map(([name, value]): [string, string] => [name, String(value)])
          : [];
  for (const [name, value] of applied) {
    search.set(name, value);
  }
  // By name only: the order of one name's values is part of the input (`sort=a&sort=b` is not `sort=b&sort=a`).
  return [...search.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function location(
  url: string,
  entrypointUrl: string | null,
  params: unknown,
): Pick<RecordedRequest, 'target' | 'origin' | 'path' | 'query'> {
  const base = entrypointUrl === null ? 'http://entrypoint.invalid/' : `${entrypointUrl}/`;
  const parsed = new URL(url, base);
  const pairs = queryPairs(parsed, params);
  const target =
    !URL.canParse(url) ||
    (entrypointUrl !== null && parsed.origin === new URL(entrypointUrl).origin)
      ? 'entrypoint'
      : 'other-origin';
  return {
    target,
    origin: target === 'entrypoint' ? null : parsed.origin,
    path: parsed.pathname,
    query: pairs.length === 0 ? null : valueDigest(pairs),
  };
}

/** Only these multipart parts carry their content in memory; stream metadata cannot establish bytes. */
function multipartEstablished(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  return (
    record(value) &&
    Object.values(value).every(
      (part) =>
        typeof part === 'string' ||
        (typeof part === 'number' && Number.isFinite(part)) ||
        typeof part === 'boolean' ||
        (record(part) &&
          typeof part.name === 'string' &&
          typeof part.mimeType === 'string' &&
          Buffer.isBuffer(part.buffer)),
    )
  );
}

/** Returns `null` for bodies whose content this synchronous summary cannot establish. */
export function summarizeRequest(
  entry: RequestEntry,
  entrypointUrl: string | null,
): RecordedRequest | null {
  const options = record(entry.options) ? entry.options : {};
  if (
    ['data', 'form', 'multipart'].some((key) => options[key] instanceof FormData) ||
    !multipartEstablished(options.multipart) ||
    ['data', 'form'].some(
      (key) => options[key] !== undefined && serialized(options[key]) === undefined,
    )
  ) {
    return null;
  }
  const headers = headerSummary(options);
  const declared = typeof options.method === 'string' ? options.method : entry.method;
  const contentType = Object.hasOwn(headers, 'content-type') ? headers['content-type'] : 'secret';
  return {
    method: declared.toUpperCase(),
    ...location(entry.url, entrypointUrl, options.params),
    body: bodyDigest(options),
    contentType: contentType === 'secret' ? null : contentType,
    headers,
  };
}

/**
 * The ordered requests only: titles are display text and do not change what was sent. `unestablished` counts the
 * requests that could not be summarized (an opaque request object, or a call made outside any stimulus step).
 * Any of them makes the fingerprint `null`, so the stimulus is reported as unestablished rather than equal to
 * another run with the same count.
 */
export function stimulusFingerprint(
  stimuli: readonly RecordedStimulus[],
  unestablished: number,
): Digest | null {
  const requests = stimuli.flatMap(({ requests: sent }) => sent);
  if (requests.length === 0 || unestablished > 0) {
    return null;
  }
  return digestOf({ requests });
}
