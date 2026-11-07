import { expect as nativeExpect } from '@playwright/test';
import { accountingExpect } from '../../assertions/expect.js';

import type { EmissionPredicate, ExpectedEmission } from './types.js';

const fields = new Set(['kind', 'operation', 'target', 'actor', 'outcome', 'attributes']);
const compare = accountingExpect(nativeExpect);

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function equals(actual: unknown, expected: unknown): boolean {
  try {
    compare(actual).toEqual(expected);
    return true;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'matcherResult' in error &&
        typeof error.matcherResult === 'object' && error.matcherResult !== null &&
        'name' in error.matcherResult && error.matcherResult.name === 'toEqual') {
      return false;
    }
    throw error;
  }
}

/** Missing facts are uncertain before any user matcher runs, including negative asymmetrics. */
export function emissionPredicate(expected: ExpectedEmission): EmissionPredicate {
  if (!object(expected) || Object.keys(expected).length === 0 ||
      Object.keys(expected).some((key) => !fields.has(key))) {
    throw new TypeError('Expected a non-empty object of normalized emission fields; use asymmetric matchers at scalar leaves.');
  }
  if ('attributes' in expected && !object(expected.attributes)) {
    throw new TypeError('Expected emission attributes to be an object of scalar expectations.');
  }
  const entries = Object.entries(expected).filter(([key]) => key !== 'attributes');
  const attributes = Object.entries(expected.attributes ?? {});
  if (entries.length + attributes.length === 0) {
    throw new TypeError('Expected at least one normalized emission fact.');
  }
  return (effect) => {
    let unknown = false;
    for (const [key, value] of entries) {
      const actual = effect[key as Exclude<keyof ExpectedEmission, 'attributes'>];
      if (actual === 'unknown') { unknown = true; }
      else if (!equals(actual, value)) { return false; }
    }
    for (const [key, value] of attributes) {
      if (!Object.hasOwn(effect.attributes, key)) { unknown = true; }
      else if (!equals(effect.attributes[key], value)) { return false; }
    }
    return unknown ? null : true;
  };
}
