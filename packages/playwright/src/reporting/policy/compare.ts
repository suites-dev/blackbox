import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse } from 'yaml';

import { policySchemaVersion, type PolicyManifest } from './manifest.js';

export type BaselineComparison =
  | { readonly kind: 'unconfigured' }
  | { readonly kind: 'match'; readonly baseline: string }
  | { readonly kind: 'drift'; readonly baseline: string; readonly differences: readonly string[] }
  | { readonly kind: 'invalid'; readonly baseline: string; readonly reason: string };

type JsonRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function show(value: unknown): string {
  return JSON.stringify(value);
}

function childPath(path: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/u.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

function collectDifferences(
  baseline: unknown,
  effective: unknown,
  path: string,
  differences: string[],
): void {
  if (!isRecord(baseline) || !isRecord(effective)) {
    if (show(baseline) !== show(effective)) {
      differences.push(`${path}: baseline ${show(baseline)}, effective ${show(effective)}`);
    }
    return;
  }
  const keys = [...new Set([...Object.keys(baseline), ...Object.keys(effective)])].sort();
  for (const key of keys) {
    const child = childPath(path, key);
    if (!Object.hasOwn(baseline, key)) {
      differences.push(`${child}: not in baseline, effective ${show(effective[key])}`);
    } else if (!Object.hasOwn(effective, key)) {
      differences.push(`${child}: baseline ${show(baseline[key])}, not in effective policy`);
    } else {
      collectDifferences(baseline[key], effective[key], child, differences);
    }
  }
}

/** Every difference between two policies, one line per changed, added, or removed path. */
export function policyDifferences(baseline: unknown, effective: unknown): string[] {
  const differences: string[] = [];
  // Round-trip so both sides compare as plain JSON.
  collectDifferences(
    baseline,
    JSON.parse(JSON.stringify(effective)) as unknown,
    'policy',
    differences,
  );
  return differences;
}

function readBaseline(path: string): { policy: unknown } | { reason: string } {
  let document: unknown;
  try {
    document = parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    return { reason: error instanceof Error ? error.message : String(error) };
  }
  if (!isRecord(document) || document.schemaVersion !== policySchemaVersion) {
    return { reason: `expected a policy manifest with schemaVersion ${policySchemaVersion}` };
  }
  if (!isRecord(document.policy)) {
    return { reason: 'expected a "policy" object' };
  }
  return { policy: document.policy };
}

/**
 * Compare the effective policy with the protected baseline file; any difference is drift.
 * The baseline path resolves from the config directory and is reported as configured.
 */
export function compareWithBaseline(
  manifest: PolicyManifest,
  baseline: string | null,
  configDir: string,
): BaselineComparison {
  if (baseline === null) {
    return { kind: 'unconfigured' };
  }
  const read = readBaseline(resolve(configDir, baseline));
  if ('reason' in read) {
    return { kind: 'invalid', baseline, reason: read.reason };
  }
  const differences = policyDifferences(read.policy, manifest.policy);
  return differences.length === 0
    ? { kind: 'match', baseline }
    : { kind: 'drift', baseline, differences };
}
