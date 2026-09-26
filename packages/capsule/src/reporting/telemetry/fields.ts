import { type createRedactionContext, redactText } from '../redaction.js';

export type Context = ReturnType<typeof createRedactionContext>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function object(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function safeText(value: unknown, context: Context): string {
  const text = string(value).replace(/\/(?:Users|home|private|tmp|var)\/[^\s"']+/gu, '[REDACTED]');
  return redactText(text.slice(0, 256), 'activityTelemetry', context);
}

export function attribute(attributes: unknown, key: string): unknown {
  return object(object(array(attributes).find((item) => object(item).key === key)).value)
    .stringValue;
}
