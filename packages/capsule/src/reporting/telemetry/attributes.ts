import type { CapsuleReportSpan } from '../telemetry-types.js';
import { array, object, string, safeText, type Context } from './fields.js';

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
]);

export function attributes(value: unknown, context: Context): CapsuleReportSpan['attributes'] {
  return array(value).flatMap((item) => {
    const entry = object(item);
    const key = string(entry.key);
    if (!allowedAttributes.has(key)) {
      return [];
    }
    const raw = object(entry.value);
    const value = raw.stringValue ?? raw.intValue ?? raw.doubleValue ?? raw.boolValue;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      return [];
    }
    return [{ key, value: typeof value === 'string' ? safeText(value, context) : value }];
  });
}
