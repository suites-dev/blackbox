import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { EffectInput } from '../model/input.js';

/**
 * Golden cases live in `test-fixtures/<group>/<case>/` (or one level up for a
 * single real capture). `input.json` stores each fragment's OTLP request as a
 * parsed object for readable diffs; the harness re-serializes it into the raw
 * JSON text the normalizer consumes, so input digests are of the fixture.
 */
export interface GoldenCase {
  readonly name: string;
  readonly input: EffectInput;
  readonly expectedPath: string;
}

interface StoredInput {
  readonly scope: EffectInput['scope'];
  readonly sources: readonly {
    readonly kind: 'otlp-json-fragments';
    readonly fragments: readonly { readonly sequence: number; readonly request: unknown }[];
  }[];
}

export const fixtureRoot = fileURLToPath(new URL('../../test-fixtures/', import.meta.url));

export function storedToInput(stored: StoredInput): EffectInput {
  return {
    scope: stored.scope,
    sources: stored.sources.map((source) => ({
      kind: source.kind,
      fragments: source.fragments.map((fragment) => ({
        sequence: fragment.sequence,
        rawJson: JSON.stringify(fragment.request),
      })),
    })),
  };
}

function caseDirectories(directory: string, name: string): readonly string[] {
  const entries = readdirSync(directory).sort();
  if (entries.includes('input.json')) {
    return [name];
  }
  return entries
    .filter((entry) => statSync(`${directory}${entry}`).isDirectory())
    .flatMap((entry) => caseDirectories(`${directory}${entry}/`, `${name}${entry}/`));
}

export function goldenCases(): readonly GoldenCase[] {
  return caseDirectories(fixtureRoot, '').map((name) => {
    const directory = `${fixtureRoot}${name}`;
    const stored = JSON.parse(readFileSync(`${directory}input.json`, 'utf8')) as StoredInput;
    return {
      name: name.replace(/\/$/u, ''),
      input: storedToInput(stored),
      expectedPath: `${directory}expected.effectset.json`,
    };
  });
}

/**
 * Goldens store canonical EffectSet bytes in a fixed 2-space rendering so a
 * regenerated golden can be reviewed line by line. `scripts/capture-fixture.mjs`
 * writes the same rendering.
 */
export function renderGolden(canonical: string): string {
  return `${JSON.stringify(JSON.parse(canonical), null, 2)}\n`;
}

export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
