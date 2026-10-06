import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

// Project paths in blackbox.gherkin.json are `/`-separated globs relative to
// the project directory. Only `*` (within one segment) and `**` (any number of
// segments) are special, the same subset as the repository's spec/code
// separation check, so one pattern means the same thing to every check.

/** Translates a `*` / `**` glob to an anchored regular expression. */
export function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    if (glob.startsWith('**/', index)) {
      source += '(?:.*/)?';
      index += 2;
    } else if (glob.startsWith('**', index)) {
      source += '.*';
      index += 1;
    } else if (glob[index] === '*') {
      source += '[^/]*';
    } else {
      source += glob[index].replace(/[$()+.?[\\\]^{|}]/gu, '\\$&');
    }
  }
  return new RegExp(`^${source}$`, 'u');
}

export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => globToRegExp(glob).test(path));
}

export const toPosix = (path: string): string => path.split(sep).join('/');

/** Directories no project scan descends into. */
const SKIPPED = new Set(['.git', 'node_modules']);

/**
 * Every file below `root`, as sorted `/`-separated paths relative to it.
 * `.git`, `node_modules` and the given directories (absolute) are skipped.
 */
export async function projectFiles(root: string, skip: readonly string[] = []): Promise<readonly string[]> {
  const skipped = new Set(skip);
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED.has(entry.name) && !skipped.has(path)) {
          await visit(path);
        }
      } else if (entry.isFile()) {
        files.push(toPosix(relative(root, path)));
      }
    }
  };
  await visit(root);
  return files.sort();
}

/** The accepted feature files: matched by a feature glob and by no drafts glob. */
export function acceptedFeatures(
  files: readonly string[],
  globs: { readonly features: readonly string[]; readonly drafts: readonly string[] },
): readonly string[] {
  return files.filter((file) => matchesAny(file, globs.features) && !matchesAny(file, globs.drafts));
}
