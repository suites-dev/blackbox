import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The generated-code runtime with stub steps and no Sandbox acquisition (see playwright-runtime.ts). */
export const stubRuntimeModule = pathToFileURL(fileURLToPath(new URL('./playwright-runtime.ts', import.meta.url))).href;

// The CLI must be the @playwright/test instance that @suites/blackbox-playwright
// imports, so it is resolved from that package. Spawning it is not an import.
async function playwrightCli(): Promise<string> {
  const dependency = fileURLToPath(
    new URL('../../../node_modules/@suites/blackbox-playwright/package.json', import.meta.url),
  );
  return createRequire(await realpath(dependency)).resolve('@playwright/test/cli');
}

export interface PlaywrightRun {
  readonly code: number;
  readonly output: string;
}

/** Runs the real Playwright test CLI in `cwd`; workspace packages resolve to their sources. */
export async function runPlaywright(
  cwd: string,
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
): Promise<PlaywrightRun> {
  const cli = await playwrightCli();
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [cli, 'test', ...args],
      {
        cwd,
        encoding: 'utf8',
        env: {
          ...process.env,
          ...env,
          NODE_OPTIONS: [process.env.NODE_OPTIONS, '--conditions=blackbox-source'].filter(Boolean).join(' '),
          FORCE_COLOR: '0',
        },
        timeout: 90_000,
      },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
        resolve({ code, output: `${stdout}\n${stderr}` });
      },
    );
  });
}
