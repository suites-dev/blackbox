import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { runProjectDriverProcess } from './project-driver-process.js';

async function projectDirectory(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'blackbox-driver-process-'));
}

it('retains a nonzero runner exit with its stderr diagnostics', async () => {
  await expect(
    runProjectDriverProcess({
      source: `process.stderr.write('project driver import failed'); process.exitCode = 7;`,
      projectDirectory: await projectDirectory(),
      requestJson: '{}',
      timeoutMs: 1_000,
    }),
  ).rejects.toThrow('code 7, signal null: project driver import failed');
});

it('terminates a driver that exceeds the bounded protocol output', async () => {
  await expect(
    runProjectDriverProcess({
      source: `process.stdout.write('x'.repeat(1024 * 1024 + 1));`,
      projectDirectory: await projectDirectory(),
      requestJson: '{}',
      timeoutMs: 1_000,
    }),
  ).rejects.toThrow('Driver protocol output exceeded 1 MiB');
});

it('includes stderr in the bounded protocol output', async () => {
  await expect(
    runProjectDriverProcess({
      source: `process.stderr.write('x'.repeat(1024 * 1024 + 1));`,
      projectDirectory: await projectDirectory(),
      requestJson: '{}',
      timeoutMs: 1_000,
    }),
  ).rejects.toThrow('Driver protocol output exceeded 1 MiB');
});

it('retains the child failure when the driver closes a large request without reading it', async () => {
  await expect(
    runProjectDriverProcess({
      source: `throw new Error('project driver import failed before request');`,
      projectDirectory: await projectDirectory(),
      requestJson: 'x'.repeat(2 * 1024 * 1024),
      timeoutMs: 1_000,
    }),
  ).rejects.toThrow('project driver import failed before request');
});

function descendantSource(pidPath: string): string {
  return `
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, ['-e',
      'require("node:fs").writeFileSync(process.argv[1], String(process.pid)); ' +
      'setInterval(() => undefined, 1000)', ${JSON.stringify(pidPath)}],
      { stdio: ['ignore', 'inherit', 'inherit'] });
    child.once('spawn', () => setInterval(() => undefined, 1000));
  `;
}

async function expectDescendantTerminated(input: {
  readonly projectDirectory: string;
  readonly pidPath: string;
}): Promise<void> {
  let pid = 0;
  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        pid = Number(await readFile(input.pidPath, 'utf8'));
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    expect(pid).toBeGreaterThan(0);
    await expect(access(input.pidPath)).resolves.toBeUndefined();
    let alive = true;
    for (let attempt = 0; attempt < 50 && alive; attempt += 1) {
      try {
        process.kill(pid, 0);
        await new Promise((resolve) => setTimeout(resolve, 10));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
          throw error;
        }
        alive = false;
      }
    }
    expect(alive).toBe(false);
  } finally {
    if (pid > 0) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* Already terminated. */
      }
    }
    await rm(input.projectDirectory, { recursive: true, force: true });
  }
}

it.skipIf(process.platform === 'win32')(
  'terminates the project driver process group when preparation times out',
  async () => {
    const directory = await projectDirectory();
    const pidPath = join(directory, 'descendant.pid');
    await expect(
      runProjectDriverProcess({
        source: descendantSource(pidPath),
        projectDirectory: directory,
        requestJson: '{}',
        timeoutMs: 200,
      }),
    ).rejects.toThrow('Driver preparation exceeded');
    await expectDescendantTerminated({ projectDirectory: directory, pidPath });
  },
);

it.skipIf(process.platform === 'win32')(
  'terminates the project driver process group at the protocol output limit',
  async () => {
    const directory = await projectDirectory();
    const pidPath = join(directory, 'descendant.pid');
    const source = `${descendantSource(pidPath)}
      const { existsSync } = await import('node:fs');
      const output = setInterval(() => {
        if (existsSync(${JSON.stringify(pidPath)})) {
          clearInterval(output);
          process.stdout.write('x'.repeat(1024 * 1024 + 1));
        }
      }, 5);
    `;
    await expect(
      runProjectDriverProcess({
        source,
        projectDirectory: directory,
        requestJson: '{}',
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow('Driver protocol output exceeded 1 MiB');
    await expectDescendantTerminated({ projectDirectory: directory, pidPath });
  },
);
