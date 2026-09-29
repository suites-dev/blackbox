import { describe, expect, it } from 'vitest';

import { toOccurrences } from './occurrences.js';
import { extractRows } from './otlp-rows.js';
import { effectInput, request, span, traceA, traceB } from '../testing/otlp.js';

const status = (value: unknown) => ({ key: 'http.response.status_code', value });
const get = span({
  traceId: traceA,
  spanId: 'aaaaaaaaaaaaaaaa',
  name: 'GET',
  kind: 2,
  attributes: [],
});

function occurrencesOf(
  fragments: readonly { readonly sequence: number; readonly request: unknown }[],
) {
  return toOccurrences(extractRows(effectInput(fragments).sources).rows);
}

describe('occurrence identity and duplicate delivery', () => {
  it('merges the same (service, trace, span) delivered in two fragments into one occurrence', () => {
    const result = occurrencesOf([
      { sequence: 2, request: request('api', [get]) },
      { sequence: 1, request: request('api', [get]) },
    ]);
    expect(result.occurrences).toHaveLength(1);
    expect(result.occurrences[0].deliveries).toEqual([1, 2]);
    expect(result.occurrences[0].row.sequence).toBe(1);
    expect(result.limitations).toEqual([]);
  });

  it('keeps the same span id under different services as two occurrences', () => {
    const result = occurrencesOf([
      { sequence: 1, request: request('api', [get]) },
      { sequence: 2, request: request('worker', [get]) },
    ]);
    expect(result.occurrences.map(({ row }) => [row.service, row.spanId])).toEqual([
      ['api', 'aaaaaaaaaaaaaaaa'],
      ['worker', 'aaaaaaaaaaaaaaaa'],
    ]);
  });

  it('keeps the same span id in different traces as two occurrences', () => {
    const other = { ...get, traceId: traceB };
    expect(
      occurrencesOf([{ sequence: 1, request: request('api', [get, other]) }]).occurrences,
    ).toHaveLength(2);
  });

  it('keeps two span ids with identical attributes as two occurrences', () => {
    const twin = { ...get, spanId: 'bbbbbbbbbbbbbbbb' };
    const result = occurrencesOf([{ sequence: 1, request: request('api', [get, twin]) }]);
    expect(result.occurrences.map(({ row }) => row.spanId)).toEqual([
      'aaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbb',
    ]);
    expect(result.occurrences.map(({ deliveries }) => deliveries)).toEqual([[1], [1]]);
  });

  it('reports conflicting duplicate content as a limitation instead of silently picking one', () => {
    const changed = { ...get, attributes: [status({ intValue: 500 })] };
    const result = occurrencesOf([
      { sequence: 3, request: request('api', [changed]) },
      { sequence: 1, request: request('api', [get]) },
    ]);
    expect(result.occurrences).toHaveLength(1);
    expect(result.occurrences[0].row.attributes).toEqual([]);
    expect(result.limitations).toEqual([
      {
        kind: 'conflicting-duplicate-delivery',
        service: 'api',
        traceId: traceA,
        spanId: 'aaaaaaaaaaaaaaaa',
        deliveries: [1, 3],
        retained: 1,
      },
    ]);
  });

  it('treats an int64 sent as a string or a number as the same content', () => {
    const asNumber = { ...get, attributes: [status({ intValue: 201 })] };
    const asString = { ...get, attributes: [status({ intValue: '201' })] };
    const result = occurrencesOf([
      { sequence: 1, request: request('api', [asNumber]) },
      { sequence: 2, request: request('api', [asString]) },
    ]);
    expect(result.limitations).toEqual([]);
    expect(result.occurrences[0].row.attributes).toEqual([
      { key: 'http.response.status_code', value: { kind: 'int', value: '201' } },
    ]);
  });

  it('treats mixed-case hex ids as the same occurrence', () => {
    const upper = { ...get, traceId: traceA.toUpperCase(), spanId: 'AAAAAAAAAAAAAAAA' };
    const result = occurrencesOf([
      { sequence: 1, request: request('api', [get]) },
      { sequence: 2, request: request('api', [upper]) },
    ]);
    expect(result.occurrences.map(({ deliveries }) => deliveries)).toEqual([[1, 2]]);
    expect(result.limitations).toEqual([]);
  });
});
