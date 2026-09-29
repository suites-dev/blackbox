import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { cliExecutable } from '../cli-path.fixture.js';
import { CAPSULE_A, twoCapsuleProject } from './project.fixture.js';
import { run } from './run-cli.fixture.js';

/** A PATH whose browser openers only record that they were launched. */
async function recordingBrowser(directory: string) {
  const bin = join(directory, 'fake-bin');
  const log = join(directory, 'browser.log');
  await mkdir(bin, { recursive: true });
  for (const name of ['open', 'xdg-open']) {
    await writeFile(join(bin, name), `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\n`);
    await chmod(join(bin, name), 0o755);
  }
  return {
    path: `${bin}:${process.env.PATH ?? ''}`,
    launches: async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean),
  };
}

/** Runs a foreground viewer until `ready` matches its output, then stops it with Ctrl-C. */
function viewer(input: {
  directory: string;
  argv: readonly string[];
  path: string;
  ready: RegExp;
}) {
  const env = { ...process.env };
  env.PATH = input.path;
  delete env.BLACKBOX_CAPSULE;
  const child = spawn(process.execPath, [cliExecutable(), ...input.argv, '--port', '0'], {
    cwd: input.directory,
    env,
  });
  let stdout = '';
  let stderr = '';
  return new Promise<{ status: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`viewer did not become ready: ${stdout}${stderr}`));
      }, 10_000);
      const check = () => {
        if (input.ready.test(stdout + stderr)) {
          setTimeout(() => child.kill('SIGINT'), 200);
        }
      };
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        stdout += chunk;
        check();
      });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        stderr += chunk;
        check();
      });
      child.once('close', (status) => {
        clearTimeout(timer);
        resolve({ status, stdout, stderr });
      });
    },
  );
}

void test('capsule report serve without --session shows the registry, keeps its three lines, opens no browser', async () => {
  const fixture = await twoCapsuleProject();
  try {
    const browser = await recordingBrowser(fixture.directory);
    const served = await viewer({
      directory: fixture.directory,
      argv: ['capsule', 'report', 'serve'],
      path: browser.path,
      ready: /Capsules keep running\.\n/u,
    });
    assert.equal(served.status, 0, served.stderr);
    assert.equal(served.stdout, '');
    const match = /^Blackbox reports: (http:\/\/127\.0\.0\.1:\d+\/)\n/u.exec(served.stderr);
    assert.ok(match !== null, served.stderr);
    assert.equal(
      served.stderr,
      `Blackbox reports: ${match[1]}\nViewer ownership: started\nPress Ctrl-C to stop the viewer. Capsules keep running.\n`,
    );
    assert.deepEqual(await browser.launches(), []);
  } finally {
    await fixture.remove();
  }
});

void test('open --json prints one viewer-open line; open opens the browser unless --no-browser', async () => {
  const fixture = await twoCapsuleProject();
  try {
    const browser = await recordingBrowser(fixture.directory);
    const quiet = await viewer({
      directory: fixture.directory,
      argv: ['open', CAPSULE_A, '--no-browser', '--json'],
      path: browser.path,
      ready: /\n$/u,
    });
    assert.equal(quiet.status, 0, quiet.stderr);
    const lines = quiet.stdout.split('\n');
    assert.equal(lines.length, 2);
    const document: unknown = JSON.parse(lines[0]);
    assert.deepEqual(
      { ...(document as Record<string, unknown>), url: 'url' },
      {
        kind: 'viewer-open',
        capsule: CAPSULE_A,
        url: 'url',
        ownership: 'started',
        browser: 'not-opened',
      },
    );
    assert.deepEqual(await browser.launches(), []);
    const human = await viewer({
      directory: fixture.directory,
      argv: ['open'],
      path: browser.path,
      ready: /capsules keep running\n/u,
    });
    assert.equal(human.stdout, '');
    assert.match(
      human.stderr,
      /^flight control: http:\/\/127\.0\.0\.1:\d+\/\nshowing: all capsules\nviewer: started, press Ctrl-C to stop; capsules keep running\n$/u,
    );
    assert.equal((await browser.launches()).length, 1);
  } finally {
    await fixture.remove();
  }
});

void test('history is ls --all and catalog list is systems', async () => {
  const fixture = await twoCapsuleProject();
  try {
    const history = await run(fixture.directory, 'history', '--json');
    const all = await run(fixture.directory, 'ls', '--all', '--json');
    assert.equal(history.status, 0, history.stderr);
    assert.equal(history.stdout, all.stdout);
    assert.equal(JSON.parse(history.stdout).scope, 'all');
    const catalogList = await run(fixture.directory, 'catalog', 'list');
    const systems = await run(fixture.directory, 'systems');
    assert.equal(catalogList.status, systems.status);
    assert.equal(catalogList.stdout + catalogList.stderr, systems.stdout + systems.stderr);
  } finally {
    await fixture.remove();
  }
});
