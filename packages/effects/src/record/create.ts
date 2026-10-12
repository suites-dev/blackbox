import {
  EFFECT_KINDS,
  EFFECTS_RECORD_SCHEMA_VERSION,
  type Effect,
  type EffectsCompleteness,
  type EffectsRecord,
  type EffectsRecordInput,
  type EffectsRecordSource,
} from './types.js';

const SOURCE_KINDS = ['playwright-attempt', 'capsule-activity'] satisfies readonly string[];
const COMPLETENESS_STATUSES = ['provisional', 'complete', 'incomplete'] satisfies readonly string[];

function compare(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

function nonEmpty(value: string, what: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${what} must be a non-empty string`);
  }
  return value;
}

/** Copies the source field by field, so extra properties and caller mutation never reach the record. */
function copySource(source: EffectsRecordSource): EffectsRecordSource {
  if (!SOURCE_KINDS.includes(source.kind)) {
    throw new TypeError(`Unknown source kind ${JSON.stringify(source.kind)}`);
  }
  return { kind: source.kind, id: nonEmpty(source.id, 'The source id') };
}

function copyCompleteness(completeness: EffectsCompleteness): EffectsCompleteness {
  if (!COMPLETENESS_STATUSES.includes(completeness.status)) {
    throw new TypeError(`Unknown completeness status ${JSON.stringify(completeness.status)}`);
  }
  if (completeness.status === 'incomplete') {
    return {
      status: 'incomplete',
      reason: nonEmpty(completeness.reason, 'An incomplete record needs a reason, and it'),
    };
  }
  return { status: completeness.status };
}

function effectKey(effect: Effect): string {
  return JSON.stringify([effect.kind, effect.operation, effect.target, effect.outcome]);
}

function checked(effect: Effect): Effect {
  if (!EFFECT_KINDS.includes(effect.kind)) {
    throw new TypeError(`Unknown effect kind ${JSON.stringify(effect.kind)}`);
  }
  for (const field of ['operation', 'target', 'outcome'] as const) {
    if (typeof effect[field] !== 'string') {
      throw new TypeError(`An effect ${field} must be a string, got ${typeof effect[field]}`);
    }
  }
  if (!Number.isSafeInteger(effect.count) || effect.count < 1) {
    throw new RangeError(
      `An effect count must be a positive safe integer, got ${String(effect.count)}`,
    );
  }
  return effect;
}

/** Equal effects are one effect with their counts added; the order never depends on the input. */
function mergeEffects(effects: readonly Effect[]): readonly Effect[] {
  const merged = new Map<string, Effect>();
  for (const input of effects) {
    const effect = checked(input);
    const key = effectKey(effect);
    const known = merged.get(key);
    const count = known === undefined ? effect.count : known.count + effect.count;
    if (!Number.isSafeInteger(count)) {
      throw new RangeError('The merged effect count is too large to be exact');
    }
    merged.set(key, {
      kind: effect.kind,
      operation: effect.operation,
      target: effect.target,
      outcome: effect.outcome,
      count,
    });
  }
  return [...merged.entries()]
    .sort(([left], [right]) => compare(left, right))
    .map(([, effect]) => effect);
}

export function createEffectsRecord(input: EffectsRecordInput): EffectsRecord {
  return {
    schemaVersion: EFFECTS_RECORD_SCHEMA_VERSION,
    source: copySource(input.source),
    completeness: copyCompleteness(input.completeness),
    effects: mergeEffects(input.effects),
  };
}
