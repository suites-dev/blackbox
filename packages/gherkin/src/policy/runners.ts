import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ValidationError } from '../feature/diagnostics.js';

// Feature files are run by Playwright through the shared step library, never
// by a Gherkin runner with its own step definitions. A project that imports
// one could make a feature pass with steps nobody reviewed. The match is
// static: it sees the import forms below, not a computed specifier.

const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/u;
// import … from 'x', import 'x', export … from 'x', import('x'), require('x').
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"`])([^'"`\n]+)\1/gu;

/** Packages that define and run their own Gherkin steps. */
const RUNNERS = [
  '@cucumber/cucumber',
  'cucumber',
  'playwright-bdd',
  'jest-cucumber',
  '@amiceli/vitest-cucumber',
  'quickpickle',
  '@badeball/cypress-cucumber-preprocessor',
] as const;

/** The runner a specifier imports, or null. */
function runnerOf(specifier: string): string | null {
  return (
    RUNNERS.find((runner) => specifier === runner || specifier.startsWith(`${runner}/`)) ?? null
  );
}

function importErrors(file: string, text: string): readonly ValidationError[] {
  return [...text.matchAll(SPECIFIER)].flatMap((match) => {
    const specifier = match[2];
    const runner = runnerOf(specifier);
    if (runner === null) {
      return [];
    }
    const before = text
      .slice(0, match.index + match[0].lastIndexOf(match[1] + specifier))
      .split('\n');
    return [
      {
        code: 'runner-import',
        file,
        line: before.length,
        column: before[before.length - 1].length + 1,
        message: `imports ${JSON.stringify(specifier)}; ${runner} runs its own step definitions, and features run only through the shared step library`,
      } satisfies ValidationError,
    ];
  });
}

/** Every import of a Gherkin runner in the project's source files (paths relative to `root`). */
export async function runnerImports(
  root: string,
  files: readonly string[],
): Promise<readonly ValidationError[]> {
  const errors: ValidationError[] = [];
  for (const file of files.filter((candidate) => SOURCE_FILE.test(candidate))) {
    errors.push(...importErrors(file, await readFile(join(root, file), 'utf8')));
  }
  return errors;
}
