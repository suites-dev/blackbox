import { describe, expect, it } from 'vitest';

import type { EffectSet, OccurrenceRef } from '../model/effect-set.js';
import type { EffectInput } from '../model/input.js';
import { normalizeEffects } from '../normalize.js';
import { goldenCases } from './fixtures.js';

// Hand-written expectations for the real capture, derived from the raw span
// inventory (not from the normalizer): see test-fixtures/README.md.
const STIMULUS_TRACE = 'cf2458fb9f77b319a1d6cb086de9b3b7';
const SEND_SPAN = 'f00519844b7c4ab9';
const SEND_TRANSPORT_SPAN = '711e2994c0843bf5';

const subscription = goldenCases().find(({ name }) => name === 'subscription')!;
const set = normalizeEffects(subscription.input);

function occurrence(result: EffectSet, spanId: string) {
  const found = result.effects.flatMap((effect) =>
    effect.occurrences
      .filter((ref) => ref.spanId === spanId)
      .map((ref: OccurrenceRef) => ({ effect, ref })),
  );
  expect(found).toHaveLength(1);
  return found[0];
}

function redeliver(input: EffectInput, sequence: number, as: number): EffectInput {
  const [source] = input.sources;
  const fragment = source.fragments.find((item) => item.sequence === sequence)!;
  return {
    ...input,
    sources: [
      {
        ...source,
        fragments: [...source.fragments, { sequence: as, rawJson: fragment.rawJson }],
      },
    ],
  };
}

describe('subscription capture, hand-written expectations', () => {
  it('keeps all 144 retained spans from 18 fragments as 144 distinct occurrences', () => {
    expect(set.inputs.map(({ sequence }) => sequence)).toEqual(
      Array.from({ length: 18 }, (_, index) => index + 1),
    );
    expect(set.effects.reduce((total, effect) => total + effect.count, 0)).toBe(144);
    expect(set.effects).toHaveLength(47);
    expect(set.limitations).toEqual([]);
    // The real run had no exporter retry: every occurrence arrived once.
    expect(set.effects.every((e) => e.occurrences.every((o) => o.deliveries.length === 1))).toBe(
      true,
    );
  });

  it('keeps the SQS SendMessage span and its HTTP POST child as distinct occurrences', () => {
    const send = occurrence(set, SEND_SPAN);
    const transport = occurrence(set, SEND_TRANSPORT_SPAN);
    expect(send.effect.identity).toEqual({
      service: 'order-service',
      spanKind: 'producer',
      name: 'subscription-orders send',
      scope: '@opentelemetry/instrumentation-aws-sdk',
    });
    expect(send.effect.count).toBe(1);
    expect(send.ref).toMatchObject({ traceId: STIMULUS_TRACE, deliveries: [16] });
    expect(transport.effect.identity).toEqual({
      service: 'order-service',
      spanKind: 'client',
      name: 'POST',
      scope: '@opentelemetry/instrumentation-http',
    });
    expect(transport.ref).toMatchObject({ traceId: STIMULUS_TRACE, deliveries: [16] });
    expect(transport.effect.id).not.toBe(send.effect.id);
    const raw = subscription.input.sources[0].fragments.find(({ sequence }) => sequence === 16)!;
    expect(raw.rawJson).toContain(
      `"spanId":"${SEND_TRANSPORT_SPAN}","parentSpanId":"${SEND_SPAN}"`,
    );
  });

  it('merges a re-delivered real fragment into existing occurrences without changing counts', () => {
    const merged = normalizeEffects(redeliver(subscription.input, 16, 19));
    expect(merged.effects.map(({ id, count }) => [id, count])).toEqual(
      set.effects.map(({ id, count }) => [id, count]),
    );
    expect(occurrence(merged, SEND_SPAN).ref.deliveries).toEqual([16, 19]);
    expect(occurrence(merged, SEND_TRANSPORT_SPAN).ref.deliveries).toEqual([16, 19]);
    expect(merged.limitations).toEqual([]);
    expect(merged.inputs).toHaveLength(19);
  });
});
