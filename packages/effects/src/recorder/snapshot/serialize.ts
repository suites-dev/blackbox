import { freezeOwned } from '../../boundary/ownership.js';
import type { ObservedEffect } from '../../graph/model.js';
import type { EffectRecorder, EffectSnapshotOptions, EffectSnapshotValue } from '../model.js';
import { recorderState } from '../ownership.js';
import { snapshotValue } from './value.js';
import { snapshotYaml } from './yaml.js';

function projected(
  emissions: readonly ObservedEffect[],
  options: EffectSnapshotOptions,
): readonly { readonly count: number; readonly value: EffectSnapshotValue }[] {
  const groups = new Map<string, { count: number; readonly value: EffectSnapshotValue }>();
  for (const emission of emissions) {
    const chosen = freezeOwned(snapshotValue(options.project(emission)));
    const value = 'normalize' in options ? snapshotValue(options.normalize(chosen)) : chosen;
    const key = JSON.stringify(value);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { count: 1, value });
    } else {
      group.count++;
    }
  }
  return [...groups.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, group]) => group);
}

/** Serialize observed values, not a claim that unobserved behavior did not occur. */
export function serializeEffectSnapshot(
  recorder: EffectRecorder,
  options: EffectSnapshotOptions,
): string {
  recorderState(recorder);
  if (!recorder.available) {
    throw new TypeError(`Cannot snapshot unavailable effects: ${recorder.unavailableReason}`);
  }
  if (
    typeof options.project !== 'function' ||
    ('normalize' in options && typeof options.normalize !== 'function')
  ) {
    throw new TypeError(
      'An effect snapshot requires an explicit projection and optional normalizer',
    );
  }
  const document = snapshotValue({
    schemaVersion: 1,
    kind: 'recorded-effect-observations',
    availability: { available: recorder.available, reason: recorder.unavailableReason },
    selector: recorder.selector,
    coverage: { ...recorder.coverage, reasons: [...recorder.coverage.reasons].sort() },
    emissions: projected(recorder.emissions, options),
    possibleEmissions: projected(recorder.possibleEmissions, options),
  });
  return snapshotYaml(document);
}
