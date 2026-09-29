import { canonicalJson, compareCodeUnits } from './canonical/jcs.js';
import { sha256Hex } from './canonical/digest.js';
import { compareOccurrenceRefs, type Occurrence, toOccurrences } from './extract/occurrences.js';
import { extractRows } from './extract/otlp-rows.js';
import type { Effect, EffectSet, OccurrenceRef } from './model/effect-set.js';
import { InvalidEffectInputError } from './model/errors.js';
import type { EffectInput } from './model/input.js';
import {
  EFFECT_NORMALIZER_VERSION,
  type Ruleset,
  builtInRuleset,
  rulesetDigest,
} from './rules/ruleset.js';

interface Classified {
  readonly key: Pick<Effect, 'kind' | 'identity' | 'linkage'> & { readonly suppression: string };
  readonly effect: Omit<Effect, 'id' | 'count' | 'occurrences'>;
  readonly ref: OccurrenceRef;
}

function classify(ruleset: Ruleset, occurrence: Occurrence): Classified {
  const { row } = occurrence;
  const effect = {
    kind: ruleset.fallback.kind,
    identity: { service: row.service, spanKind: row.kind, name: row.name, scope: row.scope },
    linkage: { kind: 'unlinked' },
    suppression: { kind: 'none' },
  } satisfies Omit<Effect, 'id' | 'count' | 'occurrences'>;
  return {
    key: {
      kind: effect.kind,
      identity: effect.identity,
      linkage: effect.linkage,
      suppression: effect.suppression.kind,
    },
    effect,
    ref: {
      service: row.service,
      traceId: row.traceId,
      spanId: row.spanId,
      deliveries: occurrence.deliveries,
      matched: { classification: ruleset.fallback.id, aliases: [], scrubbers: [] },
    },
  };
}

/**
 * Group occurrences whose identity, linkage, and suppression are equal. The
 * effect id is derived from those fields only, so it is stable across runs
 * that exercise the same behavior.
 */
function group(classified: readonly Classified[]): readonly Effect[] {
  const groups = new Map<string, { readonly first: Classified; readonly refs: OccurrenceRef[] }>();
  for (const entry of classified) {
    const key = canonicalJson(entry.key);
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, { first: entry, refs: [entry.ref] });
    } else {
      existing.refs.push(entry.ref);
    }
  }
  return [...groups]
    .map(([key, { first, refs }]) => ({
      key,
      effect: {
        id: `e_${sha256Hex(key).slice(0, 16)}`,
        ...first.effect,
        count: refs.length,
        occurrences: [...refs].sort(compareOccurrenceRefs),
      } satisfies Effect,
    }))
    .sort(
      (left, right) =>
        compareCodeUnits(left.effect.id, right.effect.id) || compareCodeUnits(left.key, right.key),
    )
    .map(({ effect }) => effect);
}

function validateScope(input: EffectInput): void {
  if (input.scope.sessionId.length === 0) {
    throw new InvalidEffectInputError('The effect scope must name one Capsule session.');
  }
}

/** Normalize with an explicit ruleset. Exposed for rule-removal controls. */
export function normalizeEffectsWith(ruleset: Ruleset, input: EffectInput): EffectSet {
  validateScope(input);
  const { rows, inputs } = extractRows(input.sources);
  const { occurrences, limitations } = toOccurrences(rows);
  return {
    schemaVersion: 1,
    kind: 'effect-set',
    normalizer: { version: EFFECT_NORMALIZER_VERSION, rulesetDigest: rulesetDigest(ruleset) },
    conventions: { kind: 'no-alias-table' },
    policy: { kind: 'unavailable' },
    scope: { kind: 'capsule-session', sessionId: input.scope.sessionId, activities: [] },
    completeness: {
      kind: 'provisional',
      reasons: ['capture-facts-unavailable', 'policy-unavailable'],
    },
    inputs,
    limitations,
    exclusions: [],
    effects: group(occurrences.map((occurrence) => classify(ruleset, occurrence))),
    captureStatus: [],
  };
}

/** Normalize retained telemetry with the built-in ruleset. Pure and I/O-free. */
export function normalizeEffects(input: EffectInput): EffectSet {
  return normalizeEffectsWith(builtInRuleset, input);
}

/** The EffectSet's RFC 8785 canonical bytes, with no trailing newline. */
export function serializeEffectSet(set: EffectSet): string {
  return canonicalJson(set);
}

/** Effects a default view shows. Nothing is suppressed by this normalizer version. */
export function defaultEffectView(set: EffectSet): readonly Effect[] {
  return set.effects;
}
