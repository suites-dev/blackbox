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
  configReferences,
  globToRegExp,
} from './check-spec-separation.mjs';

const SCRIPT = fileURLToPath(new URL('check-spec-separation.mjs', import.meta.url));

const SCRIPTS = { 'test:e2e:gherkin': 'bash demo/support/gherkin-test.sh', 'test:unit': 'vitest' };

const manifest = (gherkin, typescript = '5.7.3', scripts = SCRIPTS) =>
  `${JSON.stringify(
    {
      name: 'fixture',
      private: true,
      scripts,
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

// A config module that is not a Playwright config by name, so it is code; the
// baseline it names is still spec.
const runnerConfig = (baseline, retries = 0) => `export const runner = {
  retries: ${retries},
  reporter: [['@suites/blackbox-playwright/reporter', { policy: { baseline: '${baseline}' } }]],
};
`;

const playwrightConfig = (reporter = './tools/run-guard.mjs') => `import { join } from 'node:path';

import { runner } from './runner.config.ts';

export default {
  ...runner,
  globalSetup: './setup/global-setup.ts',
  globalTeardown: join(import.meta.dirname, 'setup', 'teardown'),
  reporter: [
    ['list'],
    // Project reporters: the guard here, the evidence writer under reporters/.
    ['${reporter}'],
    [join(import.meta.dirname, 'reporters', 'evidence.ts')],
    ['junit', { outputFile: join(process.env.RESULTS, 'junit.xml') }],
  ],
};
`;

const BASE_FILES = {
  'e2e/features/subscription-intake.feature': 'Feature: Subscription intake\n',
  'e2e/sut/app.ts': 'export const app = 1;\n',
  'packages/playwright/src/fixture.ts': 'export const fixture = 1;\n',
  'README.md': '# Fixture\n',
  'e2e/runner.config.ts': runnerConfig('./policy/runner-baseline.json'),
  'e2e/policy/runner-baseline.json': '{ "policy": { "retries": 0 } }\n',
  'e2e/playwright.config.ts': playwrightConfig(),
  'e2e/setup/global-setup.ts': 'export default () => {};\n',
  'e2e/setup/teardown.ts': 'export default () => {};\n',
  'e2e/tools/run-guard.mjs': 'export default class Guard {}\n',
  'e2e/reporters/evidence.ts': 'export default class Evidence {}\n',
  '.github/workflows/e2e.yml':
    'jobs:\n  gherkin:\n    steps:\n      - run: pnpm test:e2e:gherkin\n',
  'demo/support/gherkin-test.sh': 'playwright test --config playwright.gherkin.config.ts\n',
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

test('the runner-policy baseline is spec, so it cannot move with runner config', async (t) => {
  await t.test('accepting a new baseline alone passes', (t) => {
    const root = fixturePullRequest(t, {
      files: { 'e2e/policy/runner-baseline.json': '{ "policy": { "retries": 2 } }\n' },
    });
    const run = check(root);
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(listed(run.stdout), ['spec e2e/policy/runner-baseline.json']);
  });

  await t.test('changing the runner config and its baseline together fails', (t) => {
    const root = fixturePullRequest(t, {
      files: {
        'e2e/runner.config.ts': runnerConfig('./policy/runner-baseline.json', 2),
        'e2e/policy/runner-baseline.json': '{ "policy": { "retries": 2 } }\n',
      },
    });
    const run = check(root);
    assert.equal(run.status, 1);
    assert.match(
      run.stderr,
      /Spec: e2e\/policy\/runner-baseline\.json\. Code: e2e\/runner\.config\.ts\.$/m,
    );
  });

  await t.test('pointing the reporter at a new baseline it adds fails', (t) => {
    const root = fixturePullRequest(t, {
      files: {
        'e2e/runner.config.ts': runnerConfig('./policy/relaxed.json', 2),
        'e2e/policy/relaxed.json': '{ "policy": { "retries": 2 } }\n',
      },
    });
    const run = check(root);
    assert.equal(run.status, 1);
    assert.deepEqual(listed(run.stdout), [
      'spec e2e/policy/relaxed.json',
      'code e2e/runner.config.ts',
    ]);
  });

  await t.test('the Blackbox runner policy baseline is spec without a config naming it', (t) => {
    const root = fixturePullRequest(t, {
      files: {
        'packages/playwright/src/testing/policy/baseline.json': '{}\n',
        'packages/playwright/src/fixture.ts': 'export const fixture = 2;\n',
      },
    });
    const run = check(root);
    assert.equal(run.status, 1);
    assert.deepEqual(listed(run.stdout), [
      'spec packages/playwright/src/testing/policy/baseline.json',
      'code packages/playwright/src/fixture.ts',
    ]);
  });
});

test('how a run is configured is spec, so it cannot change with code', async (t) => {
  const code = { 'e2e/sut/app.ts': 'export const app = 2;\n' };
  const cases = {
    'a Playwright config': { 'e2e/playwright.config.ts': playwrightConfig('./tools/other.mjs') },
    'a project reporter under reporters/': {
      'e2e/reporters/evidence.ts': 'export default class Forged {}\n',
    },
    'a new project reporter under reporters/': {
      'e2e/reporters/forge.ts': 'export default class Forged {}\n',
    },
    'a project reporter the config names elsewhere': {
      'e2e/tools/run-guard.mjs': 'export default class Forged {}\n',
    },
    'the global setup the config names': {
      'e2e/setup/global-setup.ts': 'export default () => forge();\n',
    },
    'the global teardown the config names by module path': {
      'e2e/setup/teardown.ts': 'export default () => forge();\n',
    },
    'the Gherkin CI workflow': {
      '.github/workflows/e2e.yml':
        'jobs:\n  gherkin:\n    steps:\n      - run: pnpm test:e2e:gherkin --reporter=./forge.mjs\n',
    },
    'the Gherkin run script': {
      'demo/support/gherkin-test.sh':
        'playwright test --config playwright.gherkin.config.ts --reporter=./forge.mjs\n',
    },
    'the Gherkin run script entry in package.json': {
      'package.json': manifest('1.0.0', '5.7.3', {
        ...SCRIPTS,
        'test:e2e:gherkin': 'bash demo/support/gherkin-test.sh --reporter=./forge.mjs',
      }),
    },
  };
  for (const [name, files] of Object.entries(cases)) {
    await t.test(`${name}: alone passes, with code fails`, (t) => {
      const alone = check(fixturePullRequest(t, { files }));
      assert.equal(alone.status, 0, alone.stderr);
      assert.ok(
        listed(alone.stdout).every((line) => line.startsWith('spec ')),
        alone.stdout,
      );
      const mixed = check(fixturePullRequest(t, { files: { ...files, ...code } }));
      assert.equal(mixed.status, 1, mixed.stdout);
      assert.match(mixed.stderr, /Code: e2e\/sut\/app\.ts\.$/m);
    });
  }

  await t.test(
    'pointing the config at a new reporter it adds is spec, and fails with code',
    (t) => {
      const files = {
        'e2e/playwright.config.ts': playwrightConfig('./tools/forge.mjs'),
        'e2e/tools/forge.mjs': 'export default class Forged {}\n',
      };
      const alone = check(fixturePullRequest(t, { files }));
      assert.equal(alone.status, 0, alone.stderr);
      assert.deepEqual(listed(alone.stdout), [
        'spec e2e/playwright.config.ts',
        'spec e2e/tools/forge.mjs',
      ]);
      assert.equal(check(fixturePullRequest(t, { files: { ...files, ...code } })).status, 1);
    },
  );

  await t.test('another package.json script stays code', (t) => {
    const run = check(
      fixturePullRequest(t, {
        files: { 'package.json': manifest('1.0.0', '5.7.3', { ...SCRIPTS, 'test:unit': 'jest' }) },
      }),
    );
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(listed(run.stdout), ['code package.json (scripts > test:unit)']);
  });
});

test('config references resolve reporters and global setup from the config directory', () => {
  assert.deepEqual(configReferences('e2e/playwright.config.ts', playwrightConfig()), [
    'e2e/setup/global-setup.ts',
    'e2e/setup/teardown',
    'e2e/setup/teardown.*',
    'e2e/setup/teardown/index.*',
    'e2e/reporters/evidence.ts',
    'e2e/tools/run-guard.mjs',
  ]);
  const config = `export default {
    // The reporter's guard: don't swap it.
    reporter: process.env.CI ? [['dot'], ["../shared/ci-reporter.mjs", { 'a': ',' }]] : 'list',
    globalSetup: ['./setup/a.ts', require.resolve('./setup/b.ts')],
    use: { baseURL: 'http://localhost:3000/' },
  };`;
  assert.deepEqual(configReferences('apps/web/playwright.config.ts', config), [
    'apps/web/setup/a.ts',
    'apps/web/setup/b.ts',
    'apps/shared/ci-reporter.mjs',
  ]);
});

test('baseline references resolve from the config directory', () => {
  const config = `
    reporter: [[reporter, { sandboxLifecycle: false, policy: {
      baseline: process.env.BLACKBOX_TEST_POLICY_BASELINE ?? './baseline.json',
      outputFile: join(output, 'blackbox-policy.json'),
    } }]],
    other: { baseline: "../shared/blackbox.policy.json" },
    skipped: [{ baseline: \`\${root}/policy.json\` }, { baseline: '/etc/policy.json' }, { baseline: '../../../../../../out.json' }],
  `;
  assert.deepEqual(
    configReferences('packages/playwright/src/testing/policy/playwright.config.ts', config),
    [
      'packages/playwright/src/testing/policy/baseline.json',
      'packages/playwright/src/testing/shared/blackbox.policy.json',
    ],
  );
  assert.deepEqual(configReferences('playwright.config.ts', config), ['baseline.json']);
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
    'e2e/blackbox.policy.json': 'spec',
    'packages/playwright/src/testing/policy/baseline.json': 'spec',
    'packages/playwright/src/testing/policy/playwright.config.ts': 'spec',
    'e2e/playwright.config.ts': 'spec',
    'e2e/playwright.gherkin.config.ts': 'spec',
    'playwright.config.mjs': 'spec',
    'e2e/reporters/blackbox-evidence.ts': 'spec',
    '.github/workflows/e2e.yml': 'spec',
    'demo/support/gherkin-test.sh': 'spec',
    'e2e/runner.config.ts': 'code',
    'packages/playwright/src/reporter.ts': 'code',
    'demo/support/playwright-test.sh': 'code',
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

test('glob characters outside the wildcards match literally', () => {
  const pattern = globToRegExp('patches/@scope__lib@1.0.0+(build)[1]{a|b}^$.patch');
  assert.ok(pattern.test('patches/@scope__lib@1.0.0+(build)[1]{a|b}^$.patch'));
  for (const other of [
    'patches/@scope__lib@1x0x0+(build)[1]{a|b}^$.patch',
    'patches/@scope__lib@1.0.0+(build)[1]{a|b}^$xpatch',
    'patches/@scope__lib@1.0.00+(build)[1]{a|b}^$.patch',
    'patches/@scope__lib@1.0.0build1a.patch',
  ]) {
    assert.equal(pattern.test(other), false, other);
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
