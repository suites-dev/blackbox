import type { CapsuleReportSpan } from '../telemetry-types.js';
import { array, object, string, safeText, type Context } from './fields.js';

/** The attributes the report retains. Callers may pass a different allowlist. */
const allowedAttributes = new Set([
  'http.request.method',
  'http.method',
  'http.response.status_code',
  'http.status_code',
  'db.system',
  'messaging.system',
  'rpc.system',
  'otel.status_code',
  'url.path',
  'server.address',
  'server.port',
  'db.operation.name',
  'db.operation',
  'messaging.operation.type',
  'messaging.operation',
  'messaging.destination.name',
  'rpc.method',
  // Failure causes and client targets.
  'error.type',
  'url.full',
  'db.namespace',
  'db.collection.name',
]);

/** A full URL keeps its scheme, host and path; its query and fragment can carry credentials. */
function withoutQuery(key: string, value: string): string {
  return key === 'url.full' ? (value.split(/[?#]/u, 1)[0] ?? '') : value;
}

export function attributes(
  value: unknown,
  context: Context,
  allowed: ReadonlySet<string> = allowedAttributes,
): CapsuleReportSpan['attributes'] {
  return array(value).flatMap((item) => {
    const entry = object(item);
    const key = string(entry.key);
    if (!allowed.has(key)) {
      return [];
    }
    const raw = object(entry.value);
    const value = raw.stringValue ?? raw.intValue ?? raw.doubleValue ?? raw.boolValue;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      return [];
    }
    return [
      {
        key,
        value: typeof value === 'string' ? safeText(withoutQuery(key, value), context) : value,
      },
    ];
  });
}
