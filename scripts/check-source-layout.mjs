import { readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { cwd } from 'node:process';

const MAX_FILES_PER_DIRECTORY = 10;
const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.js',
  '.json',
  '.jsx',
  '.mjs',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);

async function inspectDirectory(directory, violations) {
  const entries = await readdir(directory, { withFileTypes: true });
  const sourceFiles = entries.filter(
    (entry) => entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name)),
  );
  if (sourceFiles.length > MAX_FILES_PER_DIRECTORY) {
    violations.push({ directory, files: sourceFiles.map(({ name }) => name).sort() });
  }
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => inspectDirectory(join(directory, entry.name), violations)),
  );
}

const repository = cwd();
const packagesDirectory = join(repository, 'packages');
const packages = await readdir(packagesDirectory, { withFileTypes: true });
const violations = [];
await Promise.all(
  packages
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => {
      const source = join(packagesDirectory, entry.name, 'src');
      try {
        await inspectDirectory(source, violations);
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          throw error;
        }
      }
    }),
);

for (const violation of violations.sort((left, right) =>
  left.directory.localeCompare(right.directory),
)) {
  console.error(
    `${relative(repository, violation.directory)} has ${violation.files.length} source files; maximum is ${MAX_FILES_PER_DIRECTORY}.`,
  );
  console.error(`  ${violation.files.join(', ')}`);
}

if (violations.length > 0) {
  process.exitCode = 1;
}
