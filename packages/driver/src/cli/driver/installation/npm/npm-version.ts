import { spawn } from 'node:child_process';

import { npmCommand } from './npm-command.js';

/** npm reads an `overrides` entry that points at a local `file:` package from this version on. */
export const minimumNpmVersion = '9.3.0';

function versionNumber(version: string): number | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(version.trim());
  if (match === null) {
    return null;
  }
  const [major, minor, patch] = match.slice(1).map(Number);
  return (major * 1000 + minor) * 1000 + patch;
}

/** True when npm failed on a `file:` override because it is older than `minimumNpmVersion`. */
export function npmTooOldForFileOverrides(input: {
  readonly stderr: string;
  readonly version: string;
}): boolean {
  const current = versionNumber(input.version);
  const minimum = versionNumber(minimumNpmVersion);
  return (
    input.stderr.includes('Invalid comparator: file:') &&
    current !== null &&
    minimum !== null &&
    current < minimum
  );
}

/** The npm version on PATH, or `unknown` when `npm --version` fails. */
export async function readNpmVersion(): Promise<string> {
  return await new Promise<string>((resolve) => {
    const npm = npmCommand(['--version']);
    const child = spawn(npm.command, npm.args, {
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.once('error', () => {
      resolve('unknown');
    });
    child.once('close', (code) => {
      resolve(code === 0 && stdout.trim() !== '' ? stdout.trim() : 'unknown');
    });
  });
}
