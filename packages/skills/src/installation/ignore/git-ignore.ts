import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { join } from 'node:path';

export interface SkillGitIgnoreResult {
  readonly outcome: 'not-requested' | 'unchanged' | 'updated' | 'failed';
  readonly message: string | null;
}

/** Append exact owned destinations; never replace user rules or follow a linked file. */
export async function ignoreInstalledSkills(
  projectDirectory: string,
  paths: readonly string[],
): Promise<SkillGitIgnoreResult> {
  try {
    if (paths.some((path) => !/^\.(agents|claude)\/skills\/[a-z][a-z0-9-]{0,62}$/u.test(path))) {
      throw new Error('Refusing an unsafe skill ignore path');
    }
    if (paths.length === 0) {
      return { outcome: 'unchanged', message: null };
    }
    const path = join(await realpath(projectDirectory), '.gitignore');
    const handle = await open(
      path,
      constants.O_RDWR |
        constants.O_APPEND |
        constants.O_CREAT |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK,
      0o644,
    );
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.nlink !== 1) {
        throw new Error('Refusing a non-regular or hardlinked .gitignore');
      }
      const existing = await handle.readFile('utf8');
      const lines = new Set(existing.split(/\r?\n/u));
      const rules = [...new Set(paths.map((entry) => `/${entry}/`))].filter(
        (rule) => !lines.has(rule),
      );
      if (rules.length === 0) {
        return { outcome: 'unchanged', message: null };
      }
      const current = await lstat(path);
      if (current.ino !== opened.ino || current.dev !== opened.dev || current.nlink !== 1) {
        throw new Error('.gitignore changed during installation');
      }
      const separator = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
      await handle.writeFile(`${separator}\n# Blackbox installed skills\n${rules.join('\n')}\n`);
      return { outcome: 'updated', message: null };
    } finally {
      await handle.close();
    }
  } catch (error) {
    return {
      outcome: 'failed',
      message: `Could not update .gitignore: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
