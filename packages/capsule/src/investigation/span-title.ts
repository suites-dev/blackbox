import type { CapsuleReportSpan } from '../reporting/telemetry-types.js';

type Attributes = CapsuleReportSpan['attributes'];

const HTTP_METHOD = ['http.request.method', 'http.method'];
const HTTP_ROUTE = ['http.route', 'url.path', 'http.target'];
const HTTP_STATUS = ['http.response.status_code', 'http.status_code'];
const DB_OPERATION = ['db.operation.name', 'db.operation'];
const DB_COLLECTION = ['db.collection.name', 'db.sql.table'];
const MESSAGING_OPERATION = ['messaging.operation.type', 'messaging.operation'];
const MESSAGING_DESTINATION = ['messaging.destination.name'];

/** Title parts per span family, in precedence order: HTTP, database, messaging. */
const FAMILIES = [
  [HTTP_METHOD, HTTP_ROUTE],
  [DB_OPERATION, DB_COLLECTION],
  [MESSAGING_OPERATION, MESSAGING_DESTINATION],
] satisfies readonly (readonly (readonly string[])[])[];

/**
 * Every attribute a title or result can read. The report's allowlist stays as
 * it is; investigation projections add the route and collection alternatives.
 */
export const investigationAttributeKeys = new Set<string>(
  [...FAMILIES.flat(2), ...HTTP_STATUS].concat(['db.system', 'messaging.system']),
);

/** The first present, non-empty value among `keys`, in order. */
function first(attributes: Attributes, keys: readonly string[]): string | null {
  for (const key of keys) {
    const found = attributes.find((attribute) => attribute.key === key);
    const value = found === undefined ? '' : String(found.value);
    if (value !== '') {
      return value;
    }
  }
  return null;
}

/** A route never carries its query or fragment (they can hold credentials). */
function withoutQuery(route: string): string {
  return route.split(/[?#]/u, 1)[0] ?? '';
}

/**
 * `<method> <route>`, `<operation> <collection>` or `<operation> <destination>`
 * for HTTP, database and messaging spans, else the span name. Missing parts are
 * omitted; a family with no part present does not apply.
 */
export function spanTitle(span: CapsuleReportSpan): string {
  for (const family of FAMILIES) {
    const parts = family.flatMap((keys) => {
      const value = first(span.attributes, keys);
      if (value === null) {
        return [];
      }
      const part = keys === HTTP_ROUTE ? withoutQuery(value) : value;
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
