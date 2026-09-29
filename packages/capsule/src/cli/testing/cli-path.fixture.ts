import { join } from 'node:path';

export function cliExecutable(): string {
  const packageDirectory = process.env.BLACKBOX_CLI_TEST_PACKAGE_DIRECTORY;
  if (packageDirectory === undefined) {
    throw new Error('Run CLI tests through the package-owned test runner');
  }
  return join(packageDirectory, 'bin', 'run.js');
}
