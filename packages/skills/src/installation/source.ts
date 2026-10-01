import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Plugin assets must be a self-contained ordinary directory, never a link farm. */
export async function validateSkillSource(source: string): Promise<void> {
  const entry = await lstat(source);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error(`Skill source is not an ordinary directory: ${source}`);
  }
  await readFile(join(source, 'SKILL.md'), 'utf8');
  await validateEntries(source);
}

async function validateEntries(directory: string): Promise<void> {
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    const entry = await lstat(path);
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
      throw new Error(`Unsupported skill asset: ${path}`);
    }
    if (entry.isDirectory()) {
      await validateEntries(path);
    }
  }
}
