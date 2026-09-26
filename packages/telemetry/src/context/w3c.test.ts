import { describe, expect, it } from 'vitest';

import {
  createRandomW3CIdentifierSource,
  createW3CTraceContext,
  secureW3CIdentifierSource,
} from './w3c.js';

describe('W3C trace context', () => {
  it('creates a sampled version 00 traceparent from supplied identifiers', () => {
    const context = createW3CTraceContext({
      traceId: () => '0102030405060708090a0b0c0d0e0f10',
      spanId: () => '1112131415161718',
    });

    expect(context).toEqual({
      kind: 'w3c-trace-context',
      traceId: '0102030405060708090a0b0c0d0e0f10',
      spanId: '1112131415161718',
      traceFlags: '01',
      traceparent:
        '00-0102030405060708090a0b0c0d0e0f10-1112131415161718-01',
      traceState: { kind: 'trace-state-absent' },
    });
  });

  it('creates secure non-zero identifiers with their required widths', () => {
    const context = createW3CTraceContext(secureW3CIdentifierSource);
    expect(context.traceId).toMatch(/^(?!0{32}$)[0-9a-f]{32}$/u);
    expect(context.spanId).toMatch(/^(?!0{16}$)[0-9a-f]{16}$/u);
  });

  it('repairs the forbidden all-zero output from an entropy source', () => {
    const source = createRandomW3CIdentifierSource({
      bytes: (size) => new Uint8Array(size),
    });
    expect(source.traceId()).toBe('00000000000000000000000000000001');
    expect(source.spanId()).toBe('0000000000000001');
  });

  it.each([
    ['traceId', '00000000000000000000000000000000', '1112131415161718'],
    ['traceId', 'ABCDEF0405060708090a0b0c0d0e0f10', '1112131415161718'],
    ['spanId', '0102030405060708090a0b0c0d0e0f10', '0000000000000000'],
    ['spanId', '0102030405060708090a0b0c0d0e0f10', 'short'],
  ] as const)('rejects an invalid %s', (field, traceId, spanId) => {
    expect(() =>
      createW3CTraceContext({ traceId: () => traceId, spanId: () => spanId }),
    ).toThrow(field);
  });
});
