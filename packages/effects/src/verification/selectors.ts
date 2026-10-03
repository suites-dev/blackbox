import type { EffectSelector } from '../contract.js';
import type { EffectGraph, EffectSelection, ObservedEffect } from './model.js';

/** Missing facts remain possible matches; a known contradiction still excludes them. */
export function matches(effect: ObservedEffect, selector: EffectSelector): boolean | null {
  let unknown = false;
  for (const key of ['kind', 'actor', 'operation', 'target', 'outcome'] as const) {
    if (selector[key] === undefined) {
      continue;
    }
    const actual = effect[key];
    if (actual === 'unknown') {
      unknown = true;
    } else if (actual !== selector[key]) {
      return false;
    }
  }
  for (const [key, expected] of Object.entries(selector.where ?? {})) {
    if (!Object.hasOwn(effect.attributes, key)) {
      unknown = true;
    } else if (effect.attributes[key] !== expected) {
      return false;
    }
  }
  return unknown ? null : true;
}

export function select(graph: EffectGraph, selector: EffectSelector): EffectSelection {
  const definite: ObservedEffect[] = [];
  const possible: ObservedEffect[] = [];
  for (const effect of graph.effects) {
    const match = matches(effect, selector);
    if (match === true) {
      definite.push(effect);
    } else if (match === null) {
      possible.push(effect);
    }
  }
  return { definite, possible };
}
