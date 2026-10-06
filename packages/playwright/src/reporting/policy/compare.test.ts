import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, it } from 'vitest';

import { compareWithBaseline, policyDifferences } from './compare.js';
import type { PolicyManifest } from './manifest.js';

const manifest = {
  schemaVersion: 2,
  argv: ['/usr/bin/node', '/opt/playwright/cli.js', 'test', '--retries=3'],
  policy: {
    run: {
      failOnFlakyTests: false,
      forbidOnly: false,
      fullyParallel: false,
      globalTimeout: 0,
      grep: '/.*/',
      grepInvert: null,
      maxFailures: 0,
      shard: null,
      workers: 1,
    },
    selection: {
      grep: null,
      grepInvert: null,
      projects: [],
      testFilters: [],
      lastFailed: false,
      lastFailedFile: null,
      onlyChanged: null,
      testList: null,
      testListInvert: null,
      noDeps: false,
    },
    projects: {
      primary: {
        retries: 1,
        timeout: 30000,
        expectTimeout: 5000,
        repeatEach: 1,
        grep: '/.*/',
        grepInvert: null,
        testDir: '.',
        testMatch: ['a.spec.ts', '/b\\.spec\\.ts/'],
        testIgnore: [],
      },
    },
    blackbox: { sandboxCleanupTimeoutMs: 30000 },
    tests: {
      'primary › a.spec.ts › alpha': { retries: 1, timeout: 30000 },
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
    run: { ...manifest.policy.run, shard: '1/2' },
    projects: { primary: { ...primary, testMatch: ['a.spec.ts'] } },
    tests: { 'primary › a.spec.ts › beta': { retries: 1, timeout: 30000 } },
  };
  expect(policyDifferences(baseline, effective)).toEqual([
    'policy.projects.primary.testMatch: baseline ["a.spec.ts","/b\\\\.spec\\\\.ts/"], effective ["a.spec.ts"]',
    'policy.run.shard: baseline null, effective "1/2"',
    'policy.tests["primary › a.spec.ts › alpha"]: baseline {"retries":1,"timeout":30000}, not in effective policy',
    'policy.tests["primary › a.spec.ts › beta"]: not in baseline, effective {"retries":1,"timeout":30000}',
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
  const file = join(directory, 'baseline.json');
  await writeFile(file, JSON.stringify({ schemaVersion: 2, policy: manifest.policy }));
  expect(compareWithBaseline(manifest, 'baseline.json', directory)).toEqual({
    kind: 'match',
    baseline: 'baseline.json',
  });
  const changed = structuredClone(manifest);
  changed.policy.projects.primary.retries = 2;
  expect(compareWithBaseline(changed, 'baseline.json', directory)).toEqual({
    kind: 'drift',
    baseline: 'baseline.json',
    differences: ['policy.projects.primary.retries: baseline 1, effective 2'],
  });
  expect(compareWithBaseline(manifest, null, directory)).toEqual({ kind: 'unconfigured' });
});

it.each([
  ['missing', null, 'ENOENT'],
  ['malformed', '{', 'JSON'],
  ['wrong schema', JSON.stringify({ schemaVersion: 1, policy: {} }), 'schemaVersion 2'],
  ['no policy', JSON.stringify({ schemaVersion: 2 }), '"policy" object'],
  ['array policy', JSON.stringify({ schemaVersion: 2, policy: [] }), '"policy" object'],
])('rejects an unusable baseline instead of skipping verification (%s)', async (...cases) => {
  const [, content, reason] = cases;
  if (content !== null) {
    await writeFile(join(directory, 'baseline.json'), content);
  }
  const comparison = compareWithBaseline(manifest, 'baseline.json', directory);
  expect(comparison.kind).toBe('invalid');
  expect(comparison).toMatchObject({ baseline: 'baseline.json' });
  expect('reason' in comparison && comparison.reason).toContain(reason);
});
