import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { formatValidationError } from '../feature/diagnostics.js';
import { projectFiles } from '../project/files.js';
import { validate } from '../validation/validate.js';
import { testCatalog, testSentences } from '../validation/testing/context.js';
import { cleanupRepositories, repository, type Repository } from './testing/repository.js';

// Requirements: validate checks every accepted feature of the project and,
// in the same pass, the two project rules kept from the old `check` command:
// no imports of Cucumber, playwright-bdd or a similar Gherkin runner, and no
// patched or forked copy of the step library package named by the sentence
// list. A local tarball passes only when it is a pack of that package at the
// sentence list's version. Every error names file:line:column; validate
// writes nothing.

afterEach(cleanupRepositories);

const errorsIn = async (repo: Repository) =>
  (await validate(repo.project, testSentences(), testCatalog)).map(formatValidationError);

/** Packs a package holding only its package.json into `directory` with npm, and returns the tarball's name. */
async function pack(directory: string, name: string, version: string): Promise<string> {
  const source = await mkdtemp(join(tmpdir(), 'blackbox-gherkin-pack-'));
  try {
    await writeFile(join(source, 'package.json'), JSON.stringify({ name, version }));
    await mkdir(directory, { recursive: true });
    const { stdout } = await promisify(execFile)(
      'npm',
      ['pack', '--ignore-scripts', '--silent', '--pack-destination', directory],
      { cwd: source },
    );
    return stdout.trim().split('\n').at(-1) ?? '';
  } finally {
    await rm(source, { recursive: true, force: true });
  }
}

const manifest = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

describe('validate', () => {
  it('passes a valid project that uses Gherkin tooling other than a runner, and writes nothing', async () => {
    const repo = await repository({
      'app/tools/lint.ts': "import { Parser } from '@cucumber/gherkin';\nexport { Parser };\n",
    });
    const before = await projectFiles(repo.root);
    expect(await errorsIn(repo)).toEqual([]);
    expect(await projectFiles(repo.root)).toEqual(before);
  });

  it('reports the errors of every accepted feature, and only of accepted ones', async () => {
    const repo = await repository({
      'app/features/billing/refund.feature':
        '@system:subscription-system @sandbox:default\nFeature: refund\n\n  Scenario: x\n    When the client sends GET "/r"\n',
      'app/drafts/idea.feature': 'not a feature at all\n',
    });
    expect(await errorsIn(repo)).toEqual([
      'features/billing/refund.feature:4:3: "x" has no Then step; a scenario needs at least one Then',
    ]);
  });

  it('reports a project whose feature globs match no file', async () => {
    const repo = await repository();
    await rm(join(repo.root, 'app/features'), { recursive: true });
    expect(await errorsIn(repo)).toEqual([
      'blackbox.feature.yaml:1:1: no feature file matches features/**/*.feature',
    ]);
  });
});

describe('no Gherkin runner imports', () => {
  it('reports each import of a runner at its specifier, in every import form', async () => {
    const repo = await repository({
      'app/tests/custom.ts': [
        "import { Given } from '@cucumber/cucumber';",
        "import { createBdd } from 'playwright-bdd';",
        "export * from 'playwright-bdd/decorators';",
        "const steps = require('jest-cucumber');",
        "const lazy = await import('cucumber');",
        "import { CucumberExpression } from '@cucumber/cucumber-expressions';",
      ].join('\n'),
    });
    const runs = (runner: string) =>
      `${runner} runs its own step definitions, and features run only through the shared step library`;
    expect(await errorsIn(repo)).toEqual([
      `tests/custom.ts:1:23: imports "@cucumber/cucumber"; ${runs('@cucumber/cucumber')}`,
      `tests/custom.ts:2:27: imports "playwright-bdd"; ${runs('playwright-bdd')}`,
      `tests/custom.ts:3:15: imports "playwright-bdd/decorators"; ${runs('playwright-bdd')}`,
      `tests/custom.ts:4:23: imports "jest-cucumber"; ${runs('jest-cucumber')}`,
      `tests/custom.ts:5:27: imports "cucumber"; ${runs('cucumber')}`,
    ]);
  });
});

describe('no patched or forked step library', () => {
  it('reports patches and forks up to the repository root, at their entries', async () => {
    const repo = await repository({
      'package.json': manifest({
        pnpm: {
          patchedDependencies: {
            '@example/step-library@1.2.3': 'patches/x.patch',
            'left-pad@1.0.0': 'patches/y.patch',
          },
          overrides: { '@example/step-library': 'file:../fork', lodash: '4.17.21' },
        },
        resolutions: { '**/@example/step-library': 'github:someone/fork' },
      }),
      'patches/@example__step-library@1.2.3.patch': '',
      'patches/@example+step-library+1.2.3.patch': '',
      'patches/@example__step-library-extras@1.0.0.patch': '',
      'pnpm-workspace.yaml':
        "packages:\n  - app\noverrides:\n  '@example/step-library': link:../fork\n",
      'app/package.json': manifest({
        devDependencies: { '@example/step-library': 'npm:my-fork@1.0.0', vitest: '^3.0.0' },
        overrides: {
          'some-tool': { '@example/step-library': 'git+https://example.invalid/fork.git' },
        },
      }),
    });
    const published = '; use the published package';
    expect(await errorsIn(repo)).toEqual([
      `../package.json:4:7: pnpm.patchedDependencies patches @example/step-library@1.2.3; the step library may not be patched`,
      `../package.json:8:7: pnpm.overrides points @example/step-library at "file:../fork"${published}`,
      `../package.json:13:5: resolutions points @example/step-library at "github:someone/fork"${published}`,
      '../patches/@example+step-library+1.2.3.patch:1:1: patches @example/step-library; the step library may not be patched',
      '../patches/@example__step-library@1.2.3.patch:1:1: patches @example/step-library; the step library may not be patched',
      '../pnpm-workspace.yaml:4:3: overrides names @example/step-library; the step library is used as published',
      `package.json:3:5: devDependencies points @example/step-library at "npm:my-fork@1.0.0"${published}`,
      `package.json:8:7: overrides > some-tool points @example/step-library at "git+https://example.invalid/fork.git"${published}`,
    ]);
  });

  it(
    'passes a local tarball that is a pack of the library at the sentence list version',
    { timeout: 30_000 },
    async () => {
      const repo = await repository();
      const tarball = await pack(join(repo.root, 'packages'), '@example/step-library', '1.2.3');
      await repo.write({
        'app/package.json': manifest({
          devDependencies: { '@example/step-library': `file:../packages/${tarball}` },
        }),
      });
      expect(await errorsIn(repo)).toEqual([]);
    },
  );

  it(
    'reports a tarball of another package or version, and a file that is not a tarball',
    { timeout: 30_000 },
    async () => {
      const repo = await repository();
      const fork = await pack(join(repo.root, 'packages'), 'my-fork', '1.2.3');
      const future = await pack(join(repo.root, 'packages'), '@example/step-library', '9.9.9');
      await repo.write({
        'packages/notes.tgz': 'not a tarball',
        'app/package.json': manifest({
          devDependencies: { '@example/step-library': `file:../packages/${fork}` },
          optionalDependencies: { '@example/step-library': `file:../packages/${future}` },
          overrides: { '@example/step-library': 'file:../packages/notes.tgz' },
        }),
      });
      const points = (field: string, value: string) =>
        `${field} points @example/step-library at ${JSON.stringify(value)}`;
      expect(await errorsIn(repo)).toEqual([
        `package.json:3:5: ${points('devDependencies', `file:../packages/${fork}`)}, a pack of my-fork@1.2.3; a local tarball must be a pack of @example/step-library@1.2.3`,
        `package.json:6:5: ${points('optionalDependencies', `file:../packages/${future}`)}, a pack of @example/step-library@9.9.9; a local tarball must be a pack of @example/step-library@1.2.3`,
        `package.json:9:5: ${points('overrides', 'file:../packages/notes.tgz')}, which is not a readable package tarball; use the published package or a pack of @example/step-library@1.2.3`,
      ]);
    },
  );
});
