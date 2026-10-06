import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { git } from './git.js';
import { checkProject } from './project.js';
import { cleanupRepositories, repository } from './testing/repository.js';

// Requirements (task 2.4, report sections 4.2, 4.3 and 8): `check` fails on
// project step mechanisms (step files, step-registration and other runner
// imports) and on patches or forks of the step library and its runtime, and
// on generated tests that are tracked by git. A clean project passes.

afterEach(cleanupRepositories);

describe('check passes', () => {
  it('a project whose generated output is untracked and whose own code does not import the runtime', async () => {
    const repo = await repository({
      'app/playwright.config.ts': "import { defineConfig } from '@suites/blackbox-playwright/config';\n",
      'app/.features-gen/.gitignore': '*\n',
      'app/.features-gen/features/intake.feature.spec.mjs': "import { runStep } from '@suites/blackbox-gherkin';\n",
      'app/package.json': JSON.stringify({ devDependencies: { '@suites/blackbox-gherkin': 'workspace:*' } }),
    });
    await repo.commit('base');
    expect(await checkProject(repo.project)).toEqual([]);
  });
});

describe('check fails', () => {
  it('on project step files and on imports that register or run steps outside the library', async () => {
    const repo = await repository({
      'app/support/login.steps.ts': 'export {};\n',
      'app/features/step_definitions/steps.js': 'export {};\n',
      'app/tests/custom.ts': [
        "import { Given } from '@cucumber/cucumber';",
        "import { createBdd } from 'playwright-bdd';",
        "import { runStep } from '@suites/blackbox-gherkin';",
        "const registry = require('@suites/blackbox-gherkin/dist/runtime/registry.js');",
      ].join('\n'),
    });
    await repo.commit('base');
    expect(await checkProject(repo.project)).toEqual([
      'features/step_definitions/steps.js: a project step file; steps come only from the shared Blackbox step library',
      'support/login.steps.ts: a project step file; steps come only from the shared Blackbox step library',
      'tests/custom.ts: imports "@cucumber/cucumber"; Cucumber step definitions are not the shared library',
      'tests/custom.ts: imports "playwright-bdd"; playwright-bdd defines its own steps',
      'tests/custom.ts: imports "@suites/blackbox-gherkin"; only generated tests import the Gherkin runtime',
      'tests/custom.ts: imports "@suites/blackbox-gherkin/dist/runtime/registry.js"; only generated tests import the Gherkin runtime',
    ]);
  });

  it('on patches and forks of the step library or its runtime, up to the repository root', async () => {
    const repo = await repository({
      'package.json': JSON.stringify({
        pnpm: {
          patchedDependencies: { '@suites/blackbox-gherkin@0.0.1': 'patches/x.patch', 'left-pad@1.0.0': 'patches/y.patch' },
          overrides: { '@suites/blackbox-playwright': 'file:../fork', lodash: '4.17.21' },
        },
        resolutions: { '**/@suites/blackbox-gherkin': 'github:someone/fork' },
      }),
      'patches/@suites__blackbox-playwright@0.0.1.patch': '',
      'pnpm-workspace.yaml': "packages:\n  - app\noverrides:\n  '@suites/blackbox-gherkin': link:../fork\n",
      'app/package.json': JSON.stringify({
        devDependencies: { '@suites/blackbox-gherkin': 'npm:my-fork@1.0.0', '@suites/blackbox-playwright': '^0.0.1' },
        overrides: { 'some-tool': { '@suites/blackbox-gherkin': 'git+https://example.invalid/fork.git' } },
      }),
    });
    await repo.commit('base');
    expect(await checkProject(repo.project)).toEqual([
      'package.json: devDependencies points @suites/blackbox-gherkin at "npm:my-fork@1.0.0"; use the published package',
      'package.json: overrides > some-tool points @suites/blackbox-gherkin at "git+https://example.invalid/fork.git"; use the published package',
      '../package.json: resolutions points @suites/blackbox-gherkin at "github:someone/fork"; use the published package',
      '../package.json: pnpm.overrides points @suites/blackbox-playwright at "file:../fork"; use the published package',
      '../package.json: pnpm.patchedDependencies patches @suites/blackbox-gherkin@0.0.1; the step library and its runtime may not be patched',
      '../pnpm-workspace.yaml: overrides names @suites/blackbox-gherkin; the step library and its runtime are used as published',
      '../patches/@suites__blackbox-playwright@0.0.1.patch: patches a protected package; the step library and its runtime may not be patched',
    ]);
  });

  it('on generated tests tracked by git, and outside a git repository', async () => {
    const repo = await repository({ 'app/.features-gen/features/intake.feature.spec.mjs': '// generated\n' });
    await git(['add', '--force', 'app/.features-gen'], repo.root);
    await repo.commit('base');
    expect(await checkProject(repo.project)).toEqual([
      '.features-gen/ holds generated tests and must not be tracked by git; tracked: .features-gen/features/intake.feature.spec.mjs',
    ]);
    const outside = await mkdtemp(join(tmpdir(), 'blackbox-gherkin-nogit-'));
    try {
      const problems = await checkProject({ ...repo.project, root: outside, outputDir: join(outside, '.features-gen') });
      expect(problems).toEqual([expect.stringMatching(/^cannot confirm that \.features-gen\/ is not tracked by git: /u)]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
