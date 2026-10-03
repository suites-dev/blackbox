import { freezeOwned, snapshotJson } from './boundary/ownership.js';
import { fields, items, text } from './boundary/values.js';
import { projectObservations } from './normalization/project.js';
import type { EffectGraph } from './verification/model.js';

export interface EffectProjectionInput {
  readonly format: 'otlp-json';
  readonly scopeId: string;
  readonly payloads: readonly unknown[];
}

/** Project observed operations into an immutable, open graph with explicit loss. */
export function projectEffects(input: EffectProjectionInput): EffectGraph {
  const snapshot = fields(
    snapshotJson(input),
    ['format', 'scopeId', 'payloads'],
    'projection input',
  );
  if (snapshot.format !== 'otlp-json') {
    throw new TypeError('Unsupported telemetry format');
  }
  const scopeId = text(snapshot.scopeId, 'scopeId');
  const payloads = items(snapshot.payloads, (payload) => payload, 'payloads');
  return freezeOwned(projectObservations(payloads, scopeId));
}
