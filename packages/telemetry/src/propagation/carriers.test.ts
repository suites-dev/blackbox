import { describe, expect, it } from 'vitest';

import type { W3CTraceContext } from '../context/model.js';
import {
  injectW3CProcessEnvironment,
  injectW3CTextMap,
} from './carriers.js';

const context = {
  kind: 'w3c-trace-context',
  traceId: '0102030405060708090a0b0c0d0e0f10',
  spanId: '1112131415161718',
  traceFlags: '01',
  traceparent: '00-0102030405060708090a0b0c0d0e0f10-1112131415161718-01',
  traceState: { kind: 'trace-state-absent' },
} satisfies W3CTraceContext;

describe('W3C carriers', () => {
  it('injects a traceparent while retaining unrelated text-map fields', () => {
    expect(
      injectW3CTextMap({ context, carrier: { authorization: 'token' } }),
    ).toEqual({
      kind: 'w3c-text-map-carrier',
      values: {
        authorization: 'token',
        traceparent: context.traceparent,
      },
    });
  });

  it('retains exact canonical process values and tracestate', () => {
    const traced = {
      ...context,
      traceState: { kind: 'trace-state-present', value: 'vendor=value' },
    } satisfies W3CTraceContext;
    expect(
      injectW3CProcessEnvironment({
        context: traced,
        carrier: {
          PATH: '/bin',
          TRACEPARENT: context.traceparent,
          TRACESTATE: 'vendor=value',
        },
      }),
    ).toEqual({
      kind: 'w3c-process-environment-carrier',
      variables: {
        PATH: '/bin',
        TRACEPARENT: context.traceparent,
        TRACESTATE: 'vendor=value',
      },
    });
    expect(injectW3CTextMap({ context: traced, carrier: {} }).values).toEqual({
      traceparent: context.traceparent,
      tracestate: 'vendor=value',
    });
  });

  const environment = (
    values: Readonly<Record<string, string>>,
  ): Readonly<Record<string, string>> => values;
  const contradictions = [
    environment({ TRACEPARENT: 'stale' }),
    environment({ traceparent: context.traceparent }),
    environment({ TRACESTATE: 'unexpected' }),
  ];

  it.each(contradictions)('rejects a contradictory process environment %#', (carrier) => {
    expect(() => injectW3CProcessEnvironment({ context, carrier })).toThrow(
      'contradicts canonical',
    );
  });

  it('removes stale trace state when the injected context has none', () => {
    expect(
      injectW3CTextMap({
        context,
        carrier: { TraceParent: 'stale', TraceState: 'stale' },
      }).values,
    ).toEqual({ traceparent: context.traceparent });
  });

  it('rejects context fields that contradict the serialized carrier', () => {
    expect(() =>
      injectW3CTextMap({
        context: { ...context, spanId: '2122232425262728' },
        carrier: {},
      }),
    ).toThrow('do not match traceparent');
  });

  it('rejects an empty present tracestate', () => {
    expect(() =>
      injectW3CProcessEnvironment({
        context: {
          ...context,
          traceState: { kind: 'trace-state-present', value: ' ' },
        },
        carrier: {},
      }),
    ).toThrow('tracestate must be non-empty');
  });
});
