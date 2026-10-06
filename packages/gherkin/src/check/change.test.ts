import { afterEach, describe, expect, it } from 'vitest';

import { git } from './git.js';
import { checkChange, renderChangeCheck } from './change.js';
import { cleanupRepositories, repository, type Repository } from './testing/repository.js';

// Requirements (task 2.4, report section 4.2): `check-change --base <ref>` is
// hard rule 2 for a project. A change may touch spec paths (accepted features,
// blackbox.feature.yaml, the step-library dependency entry and its
// patches) or code paths, never both. Neutral paths
// ride along with either side. The project lives in app/, so the classes are
// resolved against the repository root.

afterEach(cleanupRepositories);

/** Commits the base, applies `change` on a branch, and classifies the branch against the base. */
async function classify(change: (repo: Repository) => Promise<void>) {
  const repo = await repository();
  await repo.commit('base');
  await git(['checkout', '-q', '-b', 'change'], repo.root);
  await change(repo);
  await repo.commit('change');
  return checkChange(repo.project, { base: 'main', head: 'HEAD' });
}

const paths = (entries: readonly { readonly path: string }[]) => entries.map((entry) => entry.path);

describe('check-change passes', () => {
  it('a spec-only change: a feature and the project file, with a neutral note', async () => {
    const check = await classify((repo) =>
      repo.write({
        'app/features/intake.feature': 'Feature: intake, revised\n',
        'app/blackbox.feature.yaml': '{}\n',
        'app/README.md': '# app, revised\n',
      }),
    );
    expect(check.problem).toBeNull();
    expect(paths(check.classification.spec)).toEqual([
      'app/blackbox.feature.yaml',
      'app/features/intake.feature',
    ]);
    expect(paths(check.classification.neutral)).toEqual(['app/README.md']);
  });

  it('a code-only change, and a step-library version bump on its own', async () => {
    const code = await classify((repo) => repo.write({ 'app/src/server.ts': 'export const port = 1;\n' }));
    expect(code.problem).toBeNull();
    expect(paths(code.classification.code)).toEqual(['app/src/server.ts']);
    const bump = await classify((repo) =>
      repo.write({ 'app/package.json': JSON.stringify({ name: 'app', devDependencies: { '@suites/blackbox-gherkin': '0.0.2', vitest: '1.0.0' } }) }),
    );
    expect(bump.problem).toBeNull();
    expect(bump.classification.spec).toEqual([{ path: 'app/package.json', reason: 'devDependencies > @suites/blackbox-gherkin' }]);
  });
});

describe('check-change fails', () => {
  it('on a feature changed together with the code it judges, naming both sides', async () => {
    const check = await classify((repo) =>
      repo.write({ 'app/features/intake.feature': 'Feature: weakened\n', 'app/src/server.ts': 'export const broken = true;\n' }),
    );
    expect(check.problem).toBe(
      'this change mixes spec and code. Split it into a spec-only change and a code-only change. Spec: app/features/intake.feature. Code: app/src/server.ts.',
    );
    expect(renderChangeCheck(check)).toContain('error: this change mixes spec and code.');
  });

  it('on a library bump together with another dependency', async () => {
    const both = await classify((repo) =>
      repo.write({ 'app/package.json': JSON.stringify({ name: 'app', devDependencies: { '@suites/blackbox-gherkin': '0.0.2', vitest: '2.0.0' } }) }),
    );
    expect(both.classification.spec).toEqual([{ path: 'app/package.json', reason: 'devDependencies > @suites/blackbox-gherkin' }]);
    expect(both.classification.code).toEqual([{ path: 'app/package.json', reason: 'devDependencies > vitest' }]);
    expect(both.problem).not.toBeNull();
  });

  it('on a step-library patch with code, and on code moved into the features directory', async () => {
    const patch = await classify((repo) =>
      repo.write({ 'patches/@suites__blackbox-gherkin@0.0.1.patch': 'diff\n', 'app/src/server.ts': 'export {};\n// changed\n' }),
    );
    expect(paths(patch.classification.spec)).toEqual(['patches/@suites__blackbox-gherkin@0.0.1.patch']);
    expect(patch.problem).not.toBeNull();
    const moved = await classify(async (repo) => {
      await repo.remove('app/src/server.ts');
      await repo.write({ 'app/features/server.feature': 'export {};\n' });
    });
    expect(paths(moved.classification.spec)).toEqual(['app/features/server.feature']);
    expect(paths(moved.classification.code)).toEqual(['app/src/server.ts']);
    expect(moved.problem).not.toBeNull();
  });
});
