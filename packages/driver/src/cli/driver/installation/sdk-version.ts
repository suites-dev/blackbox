import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliPackageName = '@suites/blackbox-cli';

function currentCliVersion(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  const filesystemRoot = parse(directory).root;
  while (directory !== filesystemRoot) {
    const candidate = join(directory, 'package.json');
    if (existsSync(candidate)) {
      const manifest: unknown = JSON.parse(readFileSync(candidate, 'utf8'));
      if (
        typeof manifest === 'object' &&
        manifest !== null &&
        'name' in manifest &&
        manifest.name === cliPackageName
      ) {
        if (!('version' in manifest) || typeof manifest.version !== 'string') {
          throw new Error('Blackbox CLI package version is unavailable');
        }
        return manifest.version;
      }
    }
    directory = dirname(directory);
  }
  throw new Error('Blackbox CLI package manifest is unavailable');
}

export const defaultDriverSdkSpec = currentCliVersion();
