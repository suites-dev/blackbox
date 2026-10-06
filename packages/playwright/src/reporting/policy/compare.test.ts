import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, it } from 'vitest';
import { stringify } from 'yaml';

import { compareWithBaseline as exportedComparison } from '../../reporter.js';
import { compareWithBaseline, policyDifferences } from './compare.js';
import type { PolicyManifest } from './manifest.js';

const manifest = {
  schemaVersion: 3,
  argv: ['/usr/bin/node', '/opt/playwright/cli.js', 'test', '--retries=3'],
  policy: {
    workers: 1,
    projects: {
      primary: { retries: 1, testMatch: ['a.spec.ts', '/b\\.spec\\.ts/'] },
    },
    tests: {
      'primary › a.spec.ts › alpha': { timeout: 60000 },
    },
  },
} satisfies PolicyManifest;

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'blackbox-policy-compare-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it('reports changed, added, and removed paths with both values', () => {
  const baseline = structuredClone(manifest.policy);
  const { primary } = manifest.policy.projects;
  const effective = {
    ...manifest.policy,
    shard: '1/2',
    projects: { primary: { ...primary, testMatch: ['a.spec.ts'] } },
    tests: { 'primary › a.spec.ts › beta': { retries: 2 } },
  };
  expect(policyDifferences(baseline, effective)).toEqual([
    'policy.projects.primary.testMatch: baseline ["a.spec.ts","/b\\\\.spec\\\\.ts/"], effective ["a.spec.ts"]',
    'policy.shard: not in baseline, effective "1/2"',
    'policy.tests["primary › a.spec.ts › alpha"]: baseline {"timeout":60000}, not in effective policy',
    'policy.tests["primary › a.spec.ts › beta"]: not in baseline, effective {"retries":2}',
  ]);
  expect(policyDifferences(baseline, structuredClone(baseline))).toEqual([]);
});

it('treats a type change as drift rather than an equal value', () => {
  expect(policyDifferences({ workers: 1 }, { workers: '1' })).toEqual([
    'policy.workers: baseline 1, effective "1"',
  ]);
  expect(policyDifferences({ grep: null }, { grep: {} })).toEqual([
    'policy.grep: baseline null, effective {}',
  ]);
});

it('ignores argv but compares every policy field against the baseline file', async () => {
  const file = join(directory, 'baseline.yaml');
  // The whole written file, argv included, is a valid baseline: accepting a change is a copy.
  await writeFile(file, stringify(manifest));
  expect(compareWithBaseline(manifest, 'baseline.yaml', directory)).toEqual({
    kind: 'match',
    baseline: 'baseline.yaml',
  });
  const changed = structuredClone(manifest);
  changed.policy.projects.primary.retries = 2;
  expect(compareWithBaseline(changed, 'baseline.yaml', directory)).toEqual({
    kind: 'drift',
    baseline: 'baseline.yaml',
    differences: ['policy.projects.primary.retries: baseline 1, effective 2'],
  });
  expect(compareWithBaseline(manifest, null, directory)).toEqual({ kind: 'unconfigured' });
});

it.each([
  ['missing', null, 'ENOENT'],
  ['malformed', 'policy: [unclosed', 'Flow sequence'],
  ['wrong schema', 'schemaVersion: 2\npolicy: {}\n', 'schemaVersion 3'],
  ['no policy', 'schemaVersion: 3\n', '"policy" object'],
  ['array policy', 'schemaVersion: 3\npolicy: []\n', '"policy" object'],
])('rejects an unusable baseline instead of skipping verification (%s)', async (...cases) => {
  const [, content, reason] = cases;
  if (content !== null) {
    await writeFile(join(directory, 'baseline.yaml'), content);
  }
  const comparison = compareWithBaseline(manifest, 'baseline.yaml', directory);
  expect(comparison.kind).toBe('invalid');
  expect(comparison).toMatchObject({ baseline: 'baseline.yaml' });
  expect('reason' in comparison && comparison.reason).toContain(reason);
});

it('is exported from the reporter entry for tools that verify a finished run', () => {
  expect(exportedComparison).toBe(compareWithBaseline);
});
