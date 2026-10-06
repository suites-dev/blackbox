import { afterAll, expect, it } from 'vitest';

import {
  removeRunDirectories,
  runPolicyFixture,
  runTimeoutMs,
} from '../../testing/policy/run-playwright.js';
import { cliSelection } from './cli-selection.js';

afterAll(removeRunDirectories);

const argv = (...args: string[]) => [
  '/usr/bin/node',
  '/repo/node_modules/@playwright/test/cli.js',
  'test',
  ...args,
];

const none = {
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
};

it('records nothing when the command line selects nothing', () => {
  expect(cliSelection(argv('--config', 'playwright.config.ts', '--reporter', 'list'))).toEqual(
    none,
  );
  expect(cliSelection([])).toEqual(none);
});

it('reads every grep spelling, keeping the last one as Playwright does', () => {
  expect(cliSelection(argv('--grep', 'a')).grep).toBe('a');
  expect(cliSelection(argv('--grep=b')).grep).toBe('b');
  expect(cliSelection(argv('-g', 'c')).grep).toBe('c');
  expect(cliSelection(argv('-gd')).grep).toBe('d');
  expect(cliSelection(argv('-g', 'x', '--grep', 'y')).grep).toBe('y');
  expect(cliSelection(argv('-G', '@slow')).grepInvert).toBe('@slow');
  expect(cliSelection(argv('--grep-invert=@slow')).grepInvert).toBe('@slow');
});

it('separates test filters from option values and from arguments after --', () => {
  expect(
    cliSelection(
      argv('--reporter', 'list', 'checkout.spec.ts:42', '--workers', '2', 'cart', '--', 'extra'),
    ).testFilters,
  ).toEqual(['checkout.spec.ts:42', 'cart']);
});

it('collects projects and the remaining selection flags', () => {
  expect(
    cliSelection(
      argv(
        '--project',
        'chromium',
        'firefox',
        '--project=webkit',
        '--last-failed',
        '--last-failed-file',
        'runs/last.json',
        '--only-changed',
        '--test-list',
        'smoke.txt',
        '--test-list-invert',
        'flaky.txt',
        '--no-deps',
      ),
    ),
  ).toEqual({
    ...none,
    projects: ['chromium', 'firefox', 'webkit'],
    lastFailed: true,
    lastFailedFile: 'runs/last.json',
    onlyChanged: 'HEAD',
    testList: 'smoke.txt',
    testListInvert: 'flaky.txt',
    noDeps: true,
  });
  expect(cliSelection(argv('--only-changed', 'origin/main', 'a.spec.ts'))).toEqual({
    ...none,
    onlyChanged: 'origin/main',
    testFilters: ['a.spec.ts'],
  });
});

it(
  'prints a CLI grep in the policy header even when it selects every test (F17)',
  async () => {
    const run = await runPolicyFixture([
      '--list',
      '--grep',
      '.',
      '--project',
      'primary',
      'secondary',
    ]);
    expect(run.stderr).toContain(
      'selection: grep="." grepInvert=null projects=["primary","secondary"] testFilters=[]',
    );
    expect(run.stderr).toContain('tests: 4 selected');
    expect(run.code).toBe(1);
  },
  2 * runTimeoutMs,
);
