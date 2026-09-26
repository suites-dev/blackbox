import { randomBytes } from 'node:crypto';

import type { W3CTraceContext } from './model.js';

export interface W3CIdentifierSource {
  readonly traceId: () => string;
  readonly spanId: () => string;
}

export interface W3CEntropySource {
  readonly bytes: (size: number) => Uint8Array;
}

function randomIdentifier(bytes: number, entropy: W3CEntropySource): string {
  const identifier = Buffer.from(entropy.bytes(bytes)).toString('hex');
  return /^0+$/u.test(identifier) ? `${identifier.slice(0, -1)}1` : identifier;
}

export function createRandomW3CIdentifierSource(
  entropy: W3CEntropySource,
): W3CIdentifierSource {
  return {
    traceId: () => randomIdentifier(16, entropy),
    spanId: () => randomIdentifier(8, entropy),
  };
}

export const secureW3CIdentifierSource = createRandomW3CIdentifierSource({
  bytes: (size) => randomBytes(size),
});

function requireIdentifier(input: {
  readonly name: 'traceId' | 'spanId';
  readonly value: string;
  readonly length: 16 | 32;
}): string {
  const pattern = new RegExp(`^[0-9a-f]{${String(input.length)}}$`, 'u');
  if (!pattern.test(input.value) || /^0+$/u.test(input.value)) {
    throw new Error(`${input.name} must be a non-zero lowercase hexadecimal identifier.`);
  }
  return input.value;
}

export function createW3CTraceContext(
  source: W3CIdentifierSource,
): W3CTraceContext {
  const traceId = requireIdentifier({
    name: 'traceId',
    value: source.traceId(),
    length: 32,
  });
  const spanId = requireIdentifier({
    name: 'spanId',
    value: source.spanId(),
    length: 16,
  });
  return {
    kind: 'w3c-trace-context',
    traceId,
    spanId,
    traceFlags: '01',
    traceparent: `00-${traceId}-${spanId}-01`,
    traceState: { kind: 'trace-state-absent' },
  };
}
