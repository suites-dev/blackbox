import type { EffectScalar } from '../contract.js';

export const traceId = '11111111111111111111111111111111';

export function attribute(key: string, value: EffectScalar) {
  const field =
    typeof value === 'string'
      ? 'stringValue'
      : typeof value === 'boolean'
        ? 'boolValue'
        : 'intValue';
  return { key, value: { [field]: value } };
}

export function span(id: number, fields: Record<string, unknown> = {}) {
  return {
    traceId,
    spanId: id.toString(16).padStart(16, '0'),
    name: 'span name is not operation evidence',
    attributes: [],
    ...fields,
  };
}

export function payload(spans: readonly unknown[], actor = 'orders') {
  return {
    resourceSpans: [
      {
        resource: { attributes: [attribute('service.name', actor)] },
        scopeSpans: [{ scope: { name: 'test' }, spans }],
      },
    ],
  };
}
