import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../canonical/jcs.js';
import { normalizeEffects, serializeEffectSet } from '../normalize.js';
import { effectSetSchema } from '../schema/index.js';
import { deepFreeze, goldenCases, renderGolden } from './fixtures.js';

const validate = new Ajv2020({ strict: true, allErrors: true }).compile(effectSetSchema);
const cases = goldenCases();

describe('golden effect sets', () => {
  it('discovers every checked-in fixture', () => {
    expect(cases.map(({ name }) => name)).toEqual([
      'subscription',
      'synthetic/conflicting-delivery',
      'synthetic/duplicate-delivery',
      'synthetic/two-real-occurrences',
      'synthetic/unknown-span',
    ]);
  });

  describe.each(cases)('$name', ({ input, expectedPath }) => {
    it('normalizes to the byte-identical golden without mutating the input', () => {
      const frozen = deepFreeze(input);
      const actual = serializeEffectSet(normalizeEffects(frozen));
      const golden = readFileSync(expectedPath, 'utf8');
      // The golden is the canonical bytes plus a fixed reviewable rendering:
      // both the bytes and the rendering must match exactly.
      expect(canonicalJson(JSON.parse(golden))).toBe(actual);
      expect(golden).toBe(renderGolden(actual));
      expect(serializeEffectSet(normalizeEffects(frozen))).toBe(actual);
    });

    it('produces an effect set that satisfies the published schema', () => {
      const valid = validate(normalizeEffects(input));
      expect(validate.errors).toBeNull();
      expect(valid).toBe(true);
    });

    it('links every effect occurrence back to a delivered span', () => {
      const set = normalizeEffects(input);
      const delivered = new Set(set.inputs.map(({ sequence }) => sequence));
      const occurrences = set.effects.flatMap((effect) => effect.occurrences);
      expect(set.effects.every((effect) => effect.count === effect.occurrences.length)).toBe(true);
      expect(occurrences.every(({ deliveries }) => deliveries.every((d) => delivered.has(d)))).toBe(
        true,
      );
      const spans = input.sources.flatMap((source) =>
        source.fragments.flatMap((fragment) => spanKeys(fragment.rawJson)),
      );
      expect(occurrences).toHaveLength(new Set(spans).size);
      expect(
        new Set(
          occurrences.map(({ service, traceId, spanId }) => `${service}/${traceId}/${spanId}`),
        ),
      ).toEqual(new Set(spans));
    });
  });
});

function spanKeys(rawJson: string): readonly string[] {
  const request = JSON.parse(rawJson) as {
    readonly resourceSpans: readonly {
      readonly resource: {
        readonly attributes: readonly {
          readonly key: string;
          readonly value: { readonly stringValue: string };
        }[];
      };
      readonly scopeSpans: readonly {
        readonly spans: readonly { readonly traceId: string; readonly spanId: string }[];
      }[];
    }[];
  };
  return request.resourceSpans.flatMap((resourceSpan) => {
    const service = resourceSpan.resource.attributes.find(({ key }) => key === 'service.name')!
      .value.stringValue;
    return resourceSpan.scopeSpans.flatMap(({ spans }) =>
      spans.map(({ traceId, spanId }) => `${service}/${traceId}/${spanId}`),
    );
  });
}
