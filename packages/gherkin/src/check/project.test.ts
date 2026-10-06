import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { git } from './git.js';
import { checkProject } from './project.js';
import { cleanupRepositories, repository } from './testing/repository.js';

// Requirements (task 2.4, report sections 4.2, 4.3 and 8): `check` fails on
// project step mechanisms (step files, step-registration and other runner
// imports) and on patches or forks of the step library and its runtime, and
// on generated tests that are tracked by git. A clean project passes.
// Benchmark finding F9: the unpublished alpha installs from local tarballs, so
// a tarball packed from this release of the protected package is accepted;
// another package, another version or an unreadable file is still refused.

afterEach(cleanupRepositories);

const RELEASE = (JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as { readonly version: string }).version;

/** Packs a package holding only its package.json into `directory` with npm, and returns the tarball's name. */
async function pack(directory: string, name: string, version = RELEASE): Promise<string> {
  const source = await mkdtemp(join(tmpdir(), 'blackbox-gherkin-pack-'));
  try {
    await writeFile(join(source, 'package.json'), JSON.stringify({ name, version }));
    await mkdir(directory, { recursive: true });
    const { stdout } = await promisify(execFile)('npm', ['pack', '--ignore-scripts', '--silent', '--pack-destination', directory], { cwd: source });
    return stdout.trim().split('\n').at(-1) ?? '';
  } finally {
    await rm(source, { recursive: true, force: true });
  }
}

describe('check passes', () => {
  it('a project whose generated output is untracked and which uses only the config entry point', async () => {
    const repo = await repository({
      'app/playwright.config.ts': "import { defineGherkinConfig } from '@suites/blackbox-gherkin/config';\n",
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
      'tests/custom.ts: imports "@suites/blackbox-gherkin"; only generated tests import the Gherkin runtime; projects use @suites/blackbox-gherkin/config',
      'tests/custom.ts: imports "@suites/blackbox-gherkin/dist/runtime/registry.js"; only generated tests import the Gherkin runtime; projects use @suites/blackbox-gherkin/config',
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

describe('local tarball installs (benchmark F9)', () => {
  it('pass when they are packs of this release, as the benchmark installed the unpublished alpha', { timeout: 30_000 }, async () => {
    const repo = await repository();
    const gherkin = await pack(join(repo.root, 'packages'), '@suites/blackbox-gherkin');
    const playwright = await pack(join(repo.root, 'packages'), '@suites/blackbox-playwright');
    await repo.write({
      'app/package.json': JSON.stringify({
        devDependencies: {
          '@suites/blackbox-gherkin': `file:../packages/${gherkin}`,
          '@suites/blackbox-playwright': `file:${join(repo.root, 'packages', playwright)}`,
        },
      }),
    });
    await repo.commit('base');
    expect(await checkProject(repo.project)).toEqual([]);
  });

  it('fail for another package or version, or a file that is not a package tarball', { timeout: 30_000 }, async () => {
    const repo = await repository();
    const fork = await pack(join(repo.root, 'packages'), 'my-fork');
    const future = await pack(join(repo.root, 'packages'), '@suites/blackbox-playwright', '9.9.9');
    await repo.write({
      'packages/notes.tgz': 'not a tarball',
      'app/package.json': JSON.stringify({
        devDependencies: { '@suites/blackbox-gherkin': `file:../packages/${fork}`, '@suites/blackbox-playwright': `file:../packages/${future}` },
        overrides: { '@suites/blackbox-gherkin': 'file:../packages/notes.tgz', '@suites/blackbox-playwright': 'file:missing.tar.gz' },
      }),
    });
    await repo.commit('base');
    const points = (field: string, name: string, value: string) => `package.json: ${field} points ${name} at ${JSON.stringify(value)}`;
    expect(await checkProject(repo.project)).toEqual([
      `${points('devDependencies', '@suites/blackbox-gherkin', `file:../packages/${fork}`)}, a pack of my-fork@${RELEASE}; a local tarball must be a pack of @suites/blackbox-gherkin@${RELEASE}`,
      `${points('devDependencies', '@suites/blackbox-playwright', `file:../packages/${future}`)}, a pack of @suites/blackbox-playwright@9.9.9; a local tarball must be a pack of @suites/blackbox-playwright@${RELEASE}`,
      `${points('overrides', '@suites/blackbox-gherkin', 'file:../packages/notes.tgz')}, which is not a readable package tarball; use the published package or a pack of @suites/blackbox-gherkin@${RELEASE}`,
      `${points('overrides', '@suites/blackbox-playwright', 'file:missing.tar.gz')}, which is not a readable package tarball; use the published package or a pack of @suites/blackbox-playwright@${RELEASE}`,
    ]);
  });
});
