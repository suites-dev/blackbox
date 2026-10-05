import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

import { COMPILER_NAME, MANIFEST_FILE, type CompileManifest } from './manifest.js';

export interface OutputFile {
  readonly path: string;
  readonly code: string;
}

export interface NextOutput {
  readonly manifest: CompileManifest;
  readonly files: readonly OutputFile[];
}

function insideOutput(outputDir: string, path: string): string {
  const target = resolve(outputDir, path);
  const fromOutput = relative(outputDir, target);
  if (fromOutput === '' || fromOutput === '..' || fromOutput.startsWith(`..${sep}`)) {
    throw new Error(`Generated path ${JSON.stringify(path)} is outside ${outputDir}`);
  }
  return target;
}

async function entriesOf(outputDir: string): Promise<readonly string[]> {
  try {
    return await readdir(outputDir);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

const IGNORE_FILE = '.gitignore';
const IGNORE_CONTENT = `# Written by ${COMPILER_NAME}: generated tests are never committed.\n*\n`;

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function generatedFiles(outputDir: string, manifest: unknown): readonly string[] {
  if (typeof manifest !== 'object' || manifest === null || !('compiler' in manifest)) {
    return [];
  }
  if (manifest.compiler !== COMPILER_NAME || !('features' in manifest) || !Array.isArray(manifest.features)) {
    return [];
  }
  return (manifest.features as unknown[]).flatMap((feature) =>
    typeof feature === 'object' && feature !== null && 'generated' in feature && typeof feature.generated === 'string'
      ? [insideOutput(outputDir, feature.generated)]
      : [],
  );
}

/**
 * The generated files a previous compile recorded. A non-empty directory
 * without this compiler's ignore file is refused, so a mistyped output
 * directory is never written into or cleaned.
 */
async function previousOutput(outputDir: string): Promise<readonly string[]> {
  if ((await entriesOf(outputDir)).length === 0) {
    return [];
  }
  if ((await readOptional(resolve(outputDir, IGNORE_FILE))) !== IGNORE_CONTENT) {
    throw new Error(
      `${outputDir} is not empty and was not written by ${COMPILER_NAME}; refusing to replace its contents`,
    );
  }
  const manifest = await readOptional(resolve(outputDir, MANIFEST_FILE));
  return manifest === null ? [] : generatedFiles(outputDir, JSON.parse(manifest));
}

/**
 * Removes what the previous compile wrote, then writes the next output, or
 * nothing when the compile failed. The directory carries its own .gitignore,
 * so generated tests are never committed.
 */
export async function replaceOutput(outputDir: string, next: NextOutput | null): Promise<void> {
  const previous = await previousOutput(outputDir);
  await Promise.all(previous.map((file) => rm(file, { force: true })));
  await rm(resolve(outputDir, MANIFEST_FILE), { force: true });
  if (next === null) {
    return;
  }
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, IGNORE_FILE), IGNORE_CONTENT);
  for (const file of next.files) {
    const target = insideOutput(outputDir, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.code);
  }
  await writeFile(resolve(outputDir, MANIFEST_FILE), `${JSON.stringify(next.manifest, null, 2)}\n`);
}
