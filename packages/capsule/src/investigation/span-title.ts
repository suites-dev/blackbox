import type { CapsuleReportSpan } from '../reporting/telemetry-types.js';

type Attributes = CapsuleReportSpan['attributes'];

const HTTP_METHOD = ['http.request.method', 'http.method'];
const HTTP_ROUTE = ['http.route', 'url.path', 'http.target'];
const HTTP_STATUS = ['http.response.status_code', 'http.status_code'];
const ERROR_TYPE = ['error.type'];
const DB_OPERATION = ['db.operation.name', 'db.operation'];
const DB_COLLECTION = ['db.collection.name', 'db.mongodb.collection', 'db.sql.table'];
const MESSAGING_OPERATION = ['messaging.operation.type', 'messaging.operation'];
const MESSAGING_DESTINATION = ['messaging.destination.name'];
/** Where a client span went: its server, else the peer service name. */
const PEER = ['server.address', 'peer.service', 'net.peer.name'];

/** Title parts per span family, in precedence order: HTTP, database, messaging. */
const FAMILIES = [
  [HTTP_METHOD, HTTP_ROUTE],
  [DB_OPERATION, DB_COLLECTION],
  [MESSAGING_OPERATION, MESSAGING_DESTINATION],
] satisfies readonly (readonly (readonly string[])[])[];

/**
 * Every attribute a title or result can read, plus the `*.system` keys that
 * mark a client span as a database, messaging or RPC call (`db.system.name`
 * is the current semantic-convention name of `db.system`). The report's
 * allowlist stays as it is; investigation projections add the route and
 * collection alternatives.
 */
export const investigationAttributeKeys = new Set<string>(
  [...FAMILIES.flat(2), ...HTTP_STATUS, ...ERROR_TYPE, ...PEER].concat([
    'db.system',
    'db.system.name',
    'messaging.system',
    'rpc.system',
  ]),
);

/** The first present, non-empty attribute among `keys`, in order, with its key. */
function firstEntry(
  attributes: Attributes,
  keys: readonly string[],
): { readonly key: string; readonly value: string } | null {
  for (const key of keys) {
    const found = attributes.find((attribute) => attribute.key === key);
    const value = found === undefined ? '' : String(found.value);
    if (value !== '') {
      return { key, value };
    }
  }
  return null;
}

/** The first present, non-empty value among `keys`, in order. */
function first(attributes: Attributes, keys: readonly string[]): string | null {
  const entry = firstEntry(attributes, keys);
  return entry === null ? null : entry.value;
}

/**
 * A path segment printed as is: up to four short lowercase words joined by `-`
 * or `_` (each at most 16 letters, like `payment_intents` or `subscriptions`), or a short version
 * like `v1`. A longer run of letters is treated as a possible token, so an
 * all-lowercase credential such as `/password-reset/abcdefghijklmnopqrs` is
 * redacted too; the cost is that a long word in a raw path prints as `{…}`.
 */
const PLAIN_SEGMENT = /^(?:[a-z]{1,16}(?:[-_][a-z]{1,16}){0,3}|v\d{1,3})$/u;

/**
 * A route never carries its query or fragment (they can hold credentials).
 * `http.route` is the server's template and is kept. A raw path (`url.path`,
 * `http.target`) can carry IDs and tokens in its segments, so every segment
 * that is not a plain word becomes `{…}`: `/password-reset/9f2c…` prints as
 * `/password-reset/{…}`.
 */
function routeText(entry: { readonly key: string; readonly value: string }): string {
  return entry.key === 'http.route' ? withoutQuery(entry.value) : rawPathText(entry.value);
}

function withoutQuery(value: string): string {
  return value.split(/[?#]/u, 1)[0] ?? '';
}

/** A raw path as titles print it: no query or fragment, every non-word segment `{…}`. */
export function rawPathText(value: string): string {
  return withoutQuery(value)
    .split('/')
    .map((segment) => (segment === '' || PLAIN_SEGMENT.test(segment) ? segment : '{…}'))
    .join('/');
}

/**
 * `<method> <route>`, `<operation> <collection>` or `<operation> <destination>`
 * for HTTP, database and messaging spans, else the span name. Missing parts are
 * omitted; a family with no part present does not apply. A client or producer
 * span adds where it went: `GET → ts-price-service`, `find config → config-db`.
 */
export function spanTitle(span: CapsuleReportSpan): string {
  const target =
    span.spanKind === 'client' || span.spanKind === 'producer'
      ? first(span.attributes, PEER)
      : null;
  const title = familyTitle(span);
  return target === null ? title : `${title} → ${target}`;
}

function familyTitle(span: CapsuleReportSpan): string {
  for (const family of FAMILIES) {
    const parts = family.flatMap((keys) => {
      const entry = firstEntry(span.attributes, keys);
      if (entry === null) {
        return [];
      }
      const part = keys === HTTP_ROUTE ? routeText(entry) : entry.value;
      return part === '' ? [] : [part];
    });
    if (parts.length > 0) {
      return parts.join(' ');
    }
  }
  return span.operation;
}

/** The HTTP status code, else `error` for an error status, else empty. */
export function spanResult(span: CapsuleReportSpan): string {
  const status = first(span.attributes, HTTP_STATUS);
  if (status !== null) {
    return status;
  }
  return span.statusCode === 2 ? 'error' : '';
}

/**
 * Why an error span failed: its first exception type, else an `error.type`
 * that names a type rather than a bare status code. Empty for other spans.
 */
export function spanFailure(span: CapsuleReportSpan): string {
  if (span.statusCode !== 2) {
    return '';
  }
  const exception = span.exceptions.find((item) => item.type !== '');
  if (exception !== undefined) {
    return exception.type;
  }
  const errorType = first(span.attributes, ERROR_TYPE);
  return errorType === null || /^\d+$/u.test(errorType) ? '' : errorType;
}
