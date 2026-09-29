import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../canonical/jcs.js';
import type { EffectSet } from '../model/effect-set.js';
import { normalizeEffects, serializeEffectSet } from '../normalize.js';
import {
  type GeneratedSpan,
  generateSpans,
  generatedInput,
  mulberry32,
  partition,
  shuffle,
} from './generator.js';

// Fixed seeds: a failure names its seed and reproduces on every platform.
const SEEDS = Array.from({ length: 40 }, (_, index) => index + 1);

/** Effects without delivery lists: what must not depend on how spans arrived. */
function effectsWithoutDeliveries(set: EffectSet): string {
  return canonicalJson(
    set.effects.map((effect) => ({
      ...effect,
      occurrences: effect.occurrences.map(
        ({ deliveries: _deliveries, ...occurrence }) => occurrence,
      ),
    })),
  );
}

/** Everything except the fragment digests, which hash each fragment's exact text. */
function withoutInputs(set: EffectSet): string {
  return canonicalJson({ ...set, inputs: [] });
}

function numbered(parts: readonly (readonly GeneratedSpan[])[]) {
  return parts.map((spans, index) => ({ sequence: index + 1, spans }));
}

describe.each(SEEDS)('seeded properties (seed %i)', (seed) => {
  const random = mulberry32(seed);
  const spans = generateSpans(random, 12 + Math.floor(random() * 20));
  const fragments = numbered(partition(random, spans, 1 + Math.floor(random() * 4)));
  const baseline = normalizeEffects(generatedInput(fragments));

  it('keeps every span as exactly one occurrence', () => {
    expect(baseline.effects.reduce((total, effect) => total + effect.count, 0)).toBe(spans.length);
    expect(baseline.limitations).toEqual([]);
  });

  it('produces identical bytes when the fragment array order is shuffled', () => {
    const shuffled = normalizeEffects(generatedInput(shuffle(random, fragments)));
    expect(serializeEffectSet(shuffled)).toBe(serializeEffectSet(baseline));
  });

  it('produces identical effects when resource, scope, and span order is shuffled', () => {
    const reordered = fragments.map(({ sequence, spans: part }) => ({
      sequence,
      spans: shuffle(random, part),
    }));
    const set = normalizeEffects(generatedInput(shuffle(random, reordered)));
    // Fragment digests change with the text; everything else is byte-identical.
    expect(withoutInputs(set)).toBe(withoutInputs(baseline));
  });

  it('never changes counts when spans are delivered again', () => {
    const redelivered = Array.from({ length: 1 + Math.floor(random() * 3) }, () =>
      shuffle(random, spans).slice(0, 1 + Math.floor(random() * spans.length)),
    );
    const all = [
      ...fragments,
      ...redelivered.map((part, index) => ({
        sequence: fragments.length + index + 1,
        spans: part,
      })),
    ];
    const set = normalizeEffects(generatedInput(shuffle(random, all)));
    expect(effectsWithoutDeliveries(set)).toBe(effectsWithoutDeliveries(baseline));
    expect(set.limitations).toEqual([]);
    const deliveries = set.effects.flatMap((effect) => effect.occurrences.map((o) => o.deliveries));
    expect(deliveries.some((list) => list.length > 1)).toBe(true);
  });

  it('gives the same effects whether a trace arrives in one fragment or split across many', () => {
    const whole = normalizeEffects(generatedInput([{ sequence: 1, spans }]));
    const split = normalizeEffects(
      generatedInput(
        numbered(partition(random, shuffle(random, spans), 2 + Math.floor(random() * 5))),
      ),
    );
    expect(effectsWithoutDeliveries(split)).toBe(effectsWithoutDeliveries(whole));
    expect(effectsWithoutDeliveries(whole)).toBe(effectsWithoutDeliveries(baseline));
  });
});
