import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const FIXTURES = resolve(import.meta.dirname, '../test-fixtures');

export const FIXTURE_FEATURES = ['arguments', 'background', 'outline', 'rules', 'subsystem'] as const;

export interface FixtureProject {
  readonly root: string;
  readonly outputDir: string;
  /** Feature paths relative to the root. */
  readonly features: readonly string[];
}

const projects: string[] = [];

/** A disposable project holding copies of the fixture features under features/. */
export async function fixtureProject(): Promise<FixtureProject> {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-gherkin-'));
  projects.push(root);
  await cp(join(FIXTURES, 'features'), join(root, 'features'), { recursive: true });
  return {
    root,
    outputDir: join(root, '.features-gen'),
    features: FIXTURE_FEATURES.map((name) => `features/${name}.feature`),
  };
}

export async function cleanupProjects(): Promise<void> {
  await Promise.all(projects.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

export function fixturePath(...parts: readonly string[]): string {
  return join(FIXTURES, ...parts);
}

/**
 * Compares output with a checked-in golden file. BLACKBOX_UPDATE_GOLDEN=1
 * rewrites the golden instead; review the diff before committing it.
 */
export async function golden(name: string, actual: string): Promise<string> {
  const path = join(FIXTURES, 'golden', `${name}.golden`);
  if (process.env.BLACKBOX_UPDATE_GOLDEN === '1') {
    await writeFile(path, actual);
  }
  return readFile(path, 'utf8');
}
