import { realpath } from 'node:fs/promises';

export async function canonicalNpmInstallLocation(directory) {
  const canonical = await realpath(directory);
  return { cwd: canonical, prefix: canonical };
}
