import { describe, expect, it } from 'vitest';

import { InvalidEffectInputError } from '../model/errors.js';
import { effectInput, request, span, traceA } from '../testing/otlp.js';
import { UNKNOWN_SERVICE, extractRows } from './otlp-rows.js';
import { decodeValue } from './otlp-values.js';

const base = span({
  traceId: traceA,
  spanId: 'aaaaaaaaaaaaaaaa',
  name: 'op',
  kind: 1,
  attributes: [],
});

describe('OTLP JSON flattening', () => {
  it('flattens every resource, scope, and span into rows with service and scope', () => {
    const second = {
      ...base,
      spanId: 'bbbbbbbbbbbbbbbb',
      parentSpanId: 'aaaaaaaaaaaaaaaa',
      kind: 'SPAN_KIND_CLIENT',
    };
    const rawJson = JSON.stringify({
      resourceSpans: [
        ...(request('api', [base, second], 'scope-a').resourceSpans as unknown[]),
        { scopeSpans: [{ spans: [{ ...base, kind: undefined }] }] },
      ],
    });
    const { rows, inputs } = extractRows([
      { kind: 'otlp-json-fragments', fragments: [{ sequence: 7, rawJson }] },
    ]);
    expect(rows.map((row) => [row.service, row.scope, row.kind, row.parentSpanId])).toEqual([
      ['api', 'scope-a', 'internal', null],
      ['api', 'scope-a', 'client', 'aaaaaaaaaaaaaaaa'],
      [UNKNOWN_SERVICE, '', 'unspecified', null],
    ]);
    expect(inputs).toEqual([
      {
        kind: 'otlp-json-fragment',
        sequence: 7,
        sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      },
    ]);
  });

  it('digests the exact raw text, so equal requests with different bytes differ', () => {
    const digest = (rawJson: string) =>
      extractRows([{ kind: 'otlp-json-fragments', fragments: [{ sequence: 1, rawJson }] }])
        .inputs[0].sha256;
    const value = request('api', [base]);
    expect(digest(JSON.stringify(value))).not.toBe(digest(JSON.stringify(value, null, 2)));
    expect(digest(JSON.stringify(value))).toBe(digest(JSON.stringify(value)));
  });
});

describe('OTLP value decoding and rejection', () => {
  it('decodes every OTLP AnyValue form', () => {
    expect(decodeValue({ intValue: '-9007199254740993' }, 'v')).toEqual({
      kind: 'int',
      value: '-9007199254740993',
    });
    expect(decodeValue({ doubleValue: '1.5' }, 'v')).toEqual({ kind: 'double', value: '1.5' });
    expect(decodeValue({ boolValue: false }, 'v')).toEqual({ kind: 'bool', value: false });
    expect(decodeValue({ bytesValue: 'AQI=' }, 'v')).toEqual({ kind: 'bytes', value: 'AQI=' });
    expect(decodeValue({}, 'v')).toEqual({ kind: 'empty' });
    expect(decodeValue({ arrayValue: { values: [{ stringValue: 'x' }] } }, 'v')).toEqual({
      kind: 'array',
      values: [{ kind: 'string', value: 'x' }],
    });
    expect(
      decodeValue(
        {
          kvlistValue: {
            values: [
              { key: 'b', value: {} },
              { key: 'a', value: {} },
            ],
          },
        },
        'v',
      ),
    ).toEqual({
      kind: 'kvlist',
      values: [
        { key: 'a', value: { kind: 'empty' } },
        { key: 'b', value: { kind: 'empty' } },
      ],
    });
  });

  it.each([
    ['invalid JSON', '{'],
    ['a non-object request', '[]'],
    ['a malformed trace id', JSON.stringify(request('api', [{ ...base, traceId: 'xyz' }]))],
    ['a missing span name', JSON.stringify(request('api', [{ ...base, name: 1 }]))],
    ['an unknown span kind', JSON.stringify(request('api', [{ ...base, kind: 9 }]))],
    [
      'a fractional intValue',
      JSON.stringify(
        request('api', [{ ...base, attributes: [{ key: 'k', value: { intValue: 1.5 } }] }]),
      ),
    ],
    [
      'a two-typed AnyValue',
      JSON.stringify(
        request('api', [
          { ...base, attributes: [{ key: 'k', value: { stringValue: 'a', boolValue: true } }] },
        ]),
      ),
    ],
    ['a non-object scopeSpans entry', JSON.stringify({ resourceSpans: [{ scopeSpans: [1] }] })],
  ])('rejects %s instead of reading it partially', (_label, rawJson) => {
    expect(() =>
      extractRows([{ kind: 'otlp-json-fragments', fragments: [{ sequence: 1, rawJson }] }]),
    ).toThrow(InvalidEffectInputError);
  });

  it('rejects duplicate or invalid fragment sequences', () => {
    const one = effectInput([{ sequence: 1, request: request('api', [base]) }]).sources[0];
    expect(() => extractRows([one, one])).toThrow(/duplicated/u);
    expect(() =>
      extractRows([{ kind: 'otlp-json-fragments', fragments: [{ sequence: 0, rawJson: '{}' }] }]),
    ).toThrow(/positive integers/u);
  });
});

describe('OTLP value type checks', () => {
  it.each([
    ['a non-string stringValue', { stringValue: 1 }],
    ['a non-boolean boolValue', { boolValue: 'true' }],
    ['a non-string bytesValue', { bytesValue: 1 }],
    ['a non-object arrayValue', { arrayValue: [] }],
    ['a non-object kvlistValue', { kvlistValue: 'x' }],
    ['a blank doubleValue', { doubleValue: ' ' }],
    ['a boolean doubleValue', { doubleValue: true }],
    ['an unknown value field', { mapValue: {} }],
    ['a non-object AnyValue', 'text'],
    ['a non-array arrayValue.values', { arrayValue: { values: {} } }],
    ['a kvlist entry without a key', { kvlistValue: { values: [{ value: {} }] } }],
  ])('rejects %s', (_label, value) => {
    expect(() => decodeValue(value, 'v')).toThrow(InvalidEffectInputError);
  });

  it('treats a missing value as empty and keeps doubles in ECMAScript spelling', () => {
    expect(decodeValue(undefined, 'v')).toEqual({ kind: 'empty' });
    expect(decodeValue({ doubleValue: 0.1 }, 'v')).toEqual({ kind: 'double', value: '0.1' });
    expect(decodeValue({ intValue: 42 }, 'v')).toEqual({ kind: 'int', value: '42' });
  });
});

describe('span content used for duplicate detection', () => {
  const withExtras = (event: string) => ({
    ...base,
    events: [{ name: event, timeUnixNano: 1, attributes: [] }],
    links: [{ traceId: traceA, spanId: 'bbbbbbbbbbbbbbbb' }],
  });
  const rows = (spans: readonly Record<string, unknown>[]) =>
    extractRows(effectInput([{ sequence: 1, request: request('api', spans) }]).sources).rows;

  it('includes events and links, so a retry with different events is a different delivery', () => {
    const [first, second] = rows([withExtras('retry'), withExtras('retry')]);
    const [other] = rows([withExtras('timeout')]);
    expect(first.content).toBe(second.content);
    expect(first.content).not.toBe(other.content);
  });

  it.each([
    ['a non-object event', { ...base, events: [1] }],
    ['a non-object link', { ...base, links: ['x'] }],
    ['a malformed link id', { ...base, links: [{ traceId: traceA, spanId: 'x' }] }],
    ['a non-array attribute list', { ...base, attributes: {} }],
  ])('rejects %s', (_label, value) => {
    expect(() => rows([value])).toThrow(InvalidEffectInputError);
  });
});
