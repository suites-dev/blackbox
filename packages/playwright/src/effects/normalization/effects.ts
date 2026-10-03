import type { ObservedEffect } from '../verification/model.js';
import { textAttribute, type Attributes } from './attributes.js';
import type { SpanRecord } from './records.js';
import { record } from './values.js';

function classify(attributes: Attributes) {
  if (attributes['http.request.method'] !== undefined) {
    return {
      kind: 'http',
      operation: textAttribute(attributes, 'http.request.method'),
      target: textAttribute(attributes, 'http.route'),
    };
  }
  if (attributes['db.operation.name'] !== undefined) {
    const redis = attributes['db.system.name'] === 'redis';
    // Public table/key selectors must not match a database namespace. Redis
    // collection names also do not establish a particular cache key.
    return {
      kind: redis ? 'cache' : 'db',
      operation: textAttribute(attributes, 'db.operation.name'),
      target: redis ? 'unknown' : textAttribute(attributes, 'db.collection.name'),
    };
  }
  if (attributes['rpc.method'] !== undefined) {
    return {
      kind: 'rpc',
      operation: textAttribute(attributes, 'rpc.method'),
      target: textAttribute(attributes, 'rpc.service'),
    };
  }
  if (attributes['messaging.operation.type'] !== undefined) {
    return {
      kind: 'message',
      operation: textAttribute(attributes, 'messaging.operation.type'),
      target: textAttribute(attributes, 'messaging.destination.name'),
    };
  }
  return { kind: 'unknown', operation: 'unknown', target: 'unknown' };
}

export function projectEffect(id: string, item: SpanRecord): ObservedEffect {
  const status = record(item.span.status ?? {}, 'span status');
  return {
    id,
    ...classify(item.attributes),
    actor: textAttribute(item.resourceAttributes, 'service.name'),
    // An observed error is behavior evidence, not a persisted-state assertion.
    outcome: status.code === 2 ? 'failure' : 'unknown',
    // No production profile currently grants arbitrary span data domain meaning.
    attributes: {},
    source: [{ traceId: item.traceId, spanId: item.spanId }],
  };
}
