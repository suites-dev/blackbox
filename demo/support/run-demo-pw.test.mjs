import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const mock = `#!/usr/bin/env bash
set -eu
tool="$(basename "$0")"
printf '%s %s\\n' "$tool" "$*" >>"$DEMO_TEST_LOG"
case "$tool:$1" in
  pnpm:--version) echo 9.15.4 ;;
  pnpm:--recursive) for destination do :; done; touch "$destination/fixture.tgz" ;;
  pnpm:test:e2e:playwright)
    echo 'Blackbox live execution'
    if [[ "$DEMO_TEST_FAIL" == journey ]]; then exit 37; fi ;;
  docker:run)
    if [[ "$DEMO_TEST_FAIL" == registry ]]; then exit 42; fi
    echo owned-registry-id ;;
  docker:inspect) echo 34987 ;;
  npm:publish)
    [[ "$*" == *'--registry http://127.0.0.1:34987/'* ]] || exit 99 ;;
  git:ls-files) printf 'package.json\\0' ;;
  git:rev-parse) echo test-revision ;;
esac
`;

async function run(failure) {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-pw-launcher-test-'));
  try {
    await mkdir(join(root, 'bin'));
    await mkdir(join(root, 'e2e', '.blackbox'), { recursive: true });
    await writeFile(join(root, 'e2e', '.blackbox', 'keep'), 'existing evidence');
    await writeFile(join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@9.15.4' }));
    await copyFile(new URL('../../run-demo-pw.sh', import.meta.url), join(root, 'run-demo-pw.sh'));
    for (const tool of ['pnpm', 'docker', 'npm', 'curl', 'git']) {
      await writeFile(join(root, 'bin', tool), mock, { mode: 0o755 });
    }
    const log = join(root, 'calls.log');
    const child = spawn('bash', [join(root, 'run-demo-pw.sh')], {
      env: {
        ...process.env,
        PATH: `${join(root, 'bin')}:${process.env.PATH}`,
        DEMO_TEST_LOG: log,
        DEMO_TEST_FAIL: failure,
        PLAYWRIGHT_BROWSERS_PATH: join(root, 'browser-cache'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.stderr.on('data', (data) => {
      output += data;
    });
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    assert.equal(
      await readFile(join(root, 'e2e', '.blackbox', 'keep'), 'utf8'),
      'existing evidence',
    );
    return { code, output, calls: await readFile(log, 'utf8') };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('launcher streams tests, publishes locally and removes only its owned registry', async () => {
  const result = await run('none');
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Blackbox live execution/);
  assert.match(result.calls, /pnpm install --frozen-lockfile/);
  assert.match(result.calls, /pnpm exec playwright install chromium --only-shell/);
  assert.match(result.calls, /--publish 127\.0\.0\.1::4873/);
  assert.match(
    result.calls,
    /npm publish .*--registry http:\/\/127\.0\.0\.1:34987\/ --tag candidate/,
  );
  assert.match(result.calls, /docker rm --force owned-registry-id/);
});

test('launcher preserves test failure and still removes its registry', async () => {
  const result = await run('journey');
  assert.equal(result.code, 37, result.output);
  assert.match(result.calls, /docker rm --force owned-registry-id/);
});

test('launcher does not remove a registry when creation failed', async () => {
  const result = await run('registry');
  assert.equal(result.code, 42, result.output);
  assert.doesNotMatch(result.calls, /docker rm/);
  assert.doesNotMatch(result.calls, /npm publish/);
});
