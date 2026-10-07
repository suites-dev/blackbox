import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { stringify } from 'yaml';

import { loadGherkinProject, type GherkinProject } from '../../project/config.js';
import { git } from '../git.js';

// A disposable git repository holding a valid Gherkin project in `app/`.

export const PROJECT_FILE = {
  schemaVersion: 1,
  blackboxConfigFile: 'blackbox.config.yaml',
  features: ['features/**/*.feature'],
  sandboxes: { default: {} },
};

export const VALID_FEATURE = [
  '@system:subscription-system @sandbox:default',
  'Feature: intake',
  '',
  '  Scenario: health',
  '    When the client sends GET "/health"',
  '    Then the response status is 200',
  '',
].join('\n');

const roots: string[] = [];

export async function cleanupRepositories(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

export interface Repository {
  readonly root: string;
  readonly project: GherkinProject;
  write(files: Readonly<Record<string, string>>): Promise<void>;
}

export async function repository(
  files: Readonly<Record<string, string>> = {},
): Promise<Repository> {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-gherkin-repo-'));
  roots.push(root);
  await git(['init', '-q', '-b', 'main'], root);
  const write = async (entries: Readonly<Record<string, string>>) => {
    for (const [path, content] of Object.entries(entries)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), content);
    }
  };
  await write({
    'app/blackbox.feature.yaml': stringify(PROJECT_FILE),
    'app/features/intake.feature': VALID_FEATURE,
    'app/src/server.ts':
      "import { createServer } from 'node:http';\nexport const server = createServer();\n",
    'app/package.json': `${JSON.stringify({ name: 'app', devDependencies: { '@example/step-library': '1.2.3' } }, null, 2)}\n`,
    ...files,
  });
  return { root, project: loadGherkinProject(join(root, 'app/blackbox.feature.yaml')), write };
}
