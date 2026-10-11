import { compileConstraints, type EffectContract } from '../contract.js';
import { snapshotJson } from './ownership.js';
import { fields } from './values.js';

export function snapshotContract(value: unknown): EffectContract {
  const input = fields(snapshotJson(value), ['schemaVersion', 'constraints'], 'contract');
  if (input.schemaVersion !== 1) {
    throw new TypeError('Unsupported EffectContract schemaVersion');
  }
  return compileConstraints(input.constraints);
}
