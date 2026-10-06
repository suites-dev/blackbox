import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  checkSeparation,
  classifyChanges,
  classifyManifest,
  classifyPath,
} from './check-spec-separation.mjs';

const SCRIPT = fileURLToPath(new URL('check-spec-separation.mjs', import.meta.url));

const manifest = (gherkin, typescript = '5.7.3') =>
  `${JSON.stringify(
    {
      name: 'fixture',
      private: true,
      devDependencies: { '@suites/blackbox-gherkin': gherkin, typescript },
    },
    null,
    2,
  )}\n`;

const lockfile = (gherkin, typescript = '5.7.3') => `lockfileVersion: '9.0'

importers:

  .:
    devDependencies:
      '@suites/blackbox-gherkin':
        specifier: ${gherkin}
        version: ${gherkin}
      typescript:
        specifier: ${typescript}
        version: ${typescript}

packages:

  '@suites/blackbox-gherkin@${gherkin}':
    resolution: {integrity: sha512-gherkin-${gherkin}}

  typescript@${typescript}:
    resolution: {integrity: sha512-typescript-${typescript}}
    engines: {node: '>=14.17'}
    hasBin: true

snapshots:

  '@suites/blackbox-gherkin@${gherkin}': {}

  typescript@${typescript}: {}
`;

const BASE_FILES = {
  'e2e/features/subscription-intake.feature': 'Feature: Subscription intake\n',
  'e2e/sut/app.ts': 'export const app = 1;\n',
  'packages/playwright/src/fixture.ts': 'export const fixture = 1;\n',
  'README.md': '# Fixture\n',
  'package.json': manifest('1.0.0'),
  'pnpm-lock.yaml': lockfile('1.0.0'),
};

function git(cwd, ...args) {
  return execFileSync(
    'git',
    ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args],
    { cwd, encoding: 'utf8' },
  );
}

function write(root, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

/**
 * A repository whose `base` branch holds BASE_FILES and whose HEAD is one
 * commit on `change` that writes `files` and applies `renames` ([from, to]).
 */
function fixturePullRequest(t, { files = {}, renames = [] }) {
  const root = mkdtempSync(join(tmpdir(), 'spec-separation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q', '-b', 'base');
  git(root, 'config', 'commit.gpgsign', 'false');
  write(root, BASE_FILES);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  git(root, 'checkout', '-q', '-b', 'change');
  for (const [from, to] of renames) {
    mkdirSync(dirname(join(root, to)), { recursive: true });
    renameSync(join(root, from), join(root, to));
  }
  write(root, files);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'change');
  return root;
}

function check(cwd, args = ['--base', 'base']) {
  const run = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/** The `<class> <path>` lines the check printed, in order. */
const listed = (stdout) =>
  stdout
    .split('\n')
    .filter((line) => line.startsWith('  '))
    .map((line) => line.trim().replace(/\s+/, ' '));

test('a spec-only change passes', (t) => {
  const root = fixturePullRequest(t, {
    files: {
      'e2e/features/subscription-intake.feature': 'Feature: Subscription intake, revised\n',
      'e2e/features/renewal.feature': 'Feature: Renewal\n',
    },
  });
  const run = check(root);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(listed(run.stdout), [
    'spec e2e/features/renewal.feature',
    'spec e2e/features/subscription-intake.feature',
  ]);
});

test('a code-only change passes, and Blackbox runtime packages are code', (t) => {
  const root = fixturePullRequest(t, {
    files: {
      'e2e/sut/app.ts': 'export const app = 2;\n',
      'packages/playwright/src/fixture.ts': 'export const fixture = 2;\n',
    },
  });
  const run = check(root);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(listed(run.stdout), [
    'code e2e/sut/app.ts',
    'code packages/playwright/src/fixture.ts',
  ]);
});

test('a mixed change fails and names both sets', (t) => {
  const root = fixturePullRequest(t, {
    files: {
      'e2e/features/subscription-intake.feature': 'Feature: Subscription intake, weakened\n',
      'e2e/sut/app.ts': 'export const app = 2;\n',
      'README.md': '# Fixture, revised\n',
    },
  });
  const run = check(root);
  assert.equal(run.status, 1);
  assert.match(
    run.stderr,
    /^error spec-separation: this change mixes spec and code\. .* Spec: e2e\/features\/subscription-intake\.feature\. Code: e2e\/sut\/app\.ts\.$/m,
  );
});

test('a rename counts under its old and its new path', async (t) => {
  await t.test('within the feature directory it stays spec-only', (t) => {
    const root = fixturePullRequest(t, {
      renames: [['e2e/features/subscription-intake.feature', 'e2e/features/intake.feature']],
    });
    const run = check(root);
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(listed(run.stdout), [
      'spec e2e/features/subscription-intake.feature',
      'spec e2e/features/intake.feature',
    ]);
  });

  await t.test('out of the feature directory it is mixed', (t) => {
    const root = fixturePullRequest(t, {
      renames: [['e2e/features/subscription-intake.feature', 'e2e/sut/intake.feature']],
    });
    const run = check(root);
    assert.equal(run.status, 1);
    assert.deepEqual(listed(run.stdout), [
      'spec e2e/features/subscription-intake.feature',
      'code e2e/sut/intake.feature',
    ]);
  });

  await t.test('into the feature directory it is mixed', (t) => {
    const root = fixturePullRequest(t, {
      renames: [['e2e/sut/app.ts', 'e2e/features/app.ts']],
    });
    const run = check(root);
    assert.equal(run.status, 1);
    assert.deepEqual(listed(run.stdout), ['spec e2e/features/app.ts', 'code e2e/sut/app.ts']);
  });
});

test('a step-library bump in package.json and pnpm-lock.yaml alone is spec', (t) => {
  const root = fixturePullRequest(t, {
    files: { 'package.json': manifest('1.1.0'), 'pnpm-lock.yaml': lockfile('1.1.0') },
  });
  const run = check(root);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(listed(run.stdout), [
    'spec package.json (devDependencies > @suites/blackbox-gherkin)',
    "spec pnpm-lock.yaml (importers > . > devDependencies > '@suites/blackbox-gherkin' > specifier and 7 more)",
  ]);
});

test('a step-library bump fails next to a code change', async (t) => {
  await t.test('in another file', (t) => {
    const root = fixturePullRequest(t, {
      files: {
        'package.json': manifest('1.1.0'),
        'pnpm-lock.yaml': lockfile('1.1.0'),
        'e2e/sut/app.ts': 'export const app = 2;\n',
      },
    });
    const run = check(root);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /Spec: package\.json, pnpm-lock\.yaml\. Code: e2e\/sut\/app\.ts\.$/m);
  });

  await t.test('in the same manifests', (t) => {
    const root = fixturePullRequest(t, {
      files: {
        'package.json': manifest('1.1.0', '5.8.0'),
        'pnpm-lock.yaml': lockfile('1.1.0', '5.8.0'),
      },
    });
    const run = check(root);
    assert.equal(run.status, 1);
    assert.deepEqual(listed(run.stdout), [
      'spec package.json (devDependencies > @suites/blackbox-gherkin)',
      "spec pnpm-lock.yaml (importers > . > devDependencies > '@suites/blackbox-gherkin' > specifier and 7 more)",
      'code package.json (devDependencies > typescript)',
      'code pnpm-lock.yaml (importers > . > devDependencies > typescript > specifier and 11 more)',
    ]);
  });
});

test('a non-library dependency bump alone is code', (t) => {
  const root = fixturePullRequest(t, {
    files: {
      'package.json': manifest('1.0.0', '5.8.0'),
      'pnpm-lock.yaml': lockfile('1.0.0', '5.8.0'),
    },
  });
  const run = check(root);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(
    listed(run.stdout).map((line) => line.split(' ').slice(0, 2).join(' ')),
    ['code package.json', 'code pnpm-lock.yaml'],
  );
});

test('the check refuses arguments it cannot use and manifests it cannot read', (t) => {
  const root = fixturePullRequest(t, { files: { 'package.json': '{ "name": ' } });
  assert.equal(check(root, []).status, 2);
  assert.equal(check(root, ['--base']).status, 2);
  assert.equal(check(root, ['--base', 'no-such-ref']).status, 2);
  const run = check(root);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /cannot classify package\.json/);
});

test('path classes: spec wins, Markdown is neutral, everything else is code', () => {
  const cases = {
    'e2e/features/intake.feature': 'spec',
    'e2e/features/drafts/agent-draft.feature': 'spec',
    'e2e/features/README.md': 'spec',
    'packages/gherkin/src/library/response.ts': 'spec',
    'blackbox.gherkin.json': 'spec',
    'e2e/blackbox.gherkin.json': 'spec',
    'blackbox.policy.json': 'spec',
    'patches/@suites__blackbox-gherkin@1.0.0.patch': 'spec',
    'docs/gherkin.md': 'neutral',
    'README.md': 'neutral',
    'patches/http-cache-semantics@4.2.0.patch': 'code',
    'packages/gherkin/src/compiler/compile.ts': 'code',
    'packages/playwright/src/fixture.ts': 'code',
    'e2e/sut/app.ts': 'code',
    'e2e/.blackbox/catalog.json': 'code',
    'e2e/blackbox.config.yaml': 'code',
    'e2e/features.ts': 'code',
    '.github/workflows/ci.yml': 'code',
    'scripts/check-spec-separation.mjs': 'code',
    LICENSE: 'code',
    'package.json': 'manifest',
    'packages/gherkin/package.json': 'manifest',
    'pnpm-lock.yaml': 'manifest',
    'pnpm-workspace.yaml': 'manifest',
  };
  for (const [path, expected] of Object.entries(cases)) {
    assert.equal(classifyPath(path), expected, path);
  }
});

test('library entries are matched by package name, not by prefix', () => {
  const before = JSON.stringify({
    pnpm: { patchedDependencies: {}, overrides: { '@suites/blackbox-gherkin-extra': '1.0.0' } },
  });
  const after = JSON.stringify({
    pnpm: {
      patchedDependencies: {
        '@suites/blackbox-gherkin@1.0.0': 'patches/@suites__blackbox-gherkin@1.0.0.patch',
      },
      overrides: { '@suites/blackbox-gherkin-extra': '1.1.0' },
    },
  });
  assert.deepEqual(classifyManifest('package.json', before, after), {
    spec: ['pnpm > patchedDependencies > @suites/blackbox-gherkin@1.0.0'],
    code: ['pnpm > overrides > @suites/blackbox-gherkin-extra', 'pnpm > patchedDependencies'],
  });
});

test('a catalog bump of the library in pnpm-workspace.yaml is spec', () => {
  const workspace = (version) =>
    `packages:\n  - 'packages/*'\n\ncatalog:\n  # Step library\n  '@suites/blackbox-gherkin': ${version}\n  typescript: ~5.7.3\n`;
  assert.deepEqual(
    classifyManifest('pnpm-workspace.yaml', workspace('^1.0.0'), workspace('^1.1.0')),
    {
      spec: ["catalog > '@suites/blackbox-gherkin'"],
      code: [],
    },
  );
});

test('a manifest edit that changes no entry is code', () => {
  assert.deepEqual(
    classifyManifest('pnpm-lock.yaml', lockfile('1.0.0'), `# regenerated\n${lockfile('1.0.0')}`),
    { spec: [], code: ['formatting or comments'] },
  );
});

test('neutral paths never decide the verdict', () => {
  const neutral = { path: 'docs/gherkin.md', before: '', after: '' };
  for (const other of ['e2e/features/intake.feature', 'e2e/sut/app.ts']) {
    const result = classifyChanges([neutral, { path: other, before: '', after: '' }]);
    assert.equal(result.neutral.length, 1);
    assert.deepEqual(checkSeparation(result), []);
  }
});
