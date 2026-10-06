import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { loadGherkinProject, type GherkinProject } from '../../project/config.js';
import { git } from '../git.js';

// A disposable git repository holding a Gherkin project in `app/`, for the
// static check and the spec/code classifier.

export const PROJECT_FILE = {
  schemaVersion: 1,
  blackboxConfigFile: 'blackbox.config.yaml',
  features: ['features/**/*.feature'],
  // Outside the feature globs, so the drafts class is what makes a draft spec.
  drafts: ['drafts/**'],
  outputDir: '.features-gen',
  sandboxes: { default: {} },
  changes: { neutral: ['**/*.md'] },
};

const roots: string[] = [];

export async function cleanupRepositories(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

export interface Repository {
  readonly root: string;
  readonly project: GherkinProject;
  write(files: Readonly<Record<string, string>>): Promise<void>;
  remove(path: string): Promise<void>;
  commit(message: string): Promise<string>;
}

export async function repository(files: Readonly<Record<string, string>> = {}): Promise<Repository> {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-gherkin-repo-'));
  roots.push(root);
  const run = (args: readonly string[]) => git(args, root);
  await run(['init', '-q', '-b', 'main']);
  await run(['config', 'user.email', 'test@example.invalid']);
  await run(['config', 'user.name', 'test']);
  await run(['config', 'commit.gpgsign', 'false']);
  const write = async (entries: Readonly<Record<string, string>>) => {
    for (const [path, content] of Object.entries(entries)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), content);
    }
  };
  await write({
    'app/blackbox.gherkin.json': `${JSON.stringify(PROJECT_FILE, null, 2)}\n`,
    'app/features/intake.feature': 'Feature: intake\n',
    'app/src/server.ts': 'export {};\n',
    'app/README.md': '# app\n',
    'app/package.json': `${JSON.stringify({ name: 'app', devDependencies: { '@suites/blackbox-gherkin': '0.0.1', vitest: '1.0.0' } }, null, 2)}\n`,
    ...files,
  });
  return {
    root,
    project: loadGherkinProject(join(root, 'app/blackbox.gherkin.json')),
    write,
    remove: (path) => rm(join(root, path), { recursive: true }),
    commit: async (message) => {
      await run(['add', '--all']);
      await run(['commit', '-q', '--allow-empty', '-m', message]);
      return (await run(['rev-parse', 'HEAD'])).trim();
    },
  };
}
