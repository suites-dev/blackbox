import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

import { buildArtifactName, collectEvidence, redactSecrets, runCommand } from './ci-evidence.mjs';

const scriptPath = fileURLToPath(new URL('./ci-evidence.mjs', import.meta.url));

function waitForLine(stream, pattern, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${pattern}`)),
      timeoutMs,
    );
    stream.on('data', (chunk) => {
      output += chunk;
      const match = output.match(pattern);
      if (match) {
        clearTimeout(timeout);
        resolve(match);
      }
    });
  });
}

function waitForExit(child, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      child.removeListener('exit', onExit);
      child.removeListener('error', onError);
    };
    const onExit = (code, signal) => {
      cleanup();
      resolve({ code, signal });
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('wrapper did not exit within outer timeout'));
    }, timeoutMs);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    if (process.platform === 'linux') {
      const state = readFileSync(`/proc/${pid}/stat`, 'utf8').match(/^\d+ \(.+\) (\S)/)?.[1];
      if (state === 'Z') return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function eventuallyDead(pid) {
  for (let attempt = 0; attempt < 50 && pidIsAlive(pid); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(pidIsAlive(pid), false, `pid ${pid} remained alive`);
}

async function stopWrapper(wrapper) {
  if (!wrapper || wrapper.exitCode !== null || wrapper.signalCode !== null) return;
  wrapper.kill('SIGTERM');
  try {
    await waitForExit(wrapper, 2_000);
  } catch {
    wrapper.kill('SIGKILL');
  }
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'blackbox-ci-evidence-'));
  await writeFile(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  await mkdir(path.join(root, 'reports/junit'), { recursive: true });
  await mkdir(path.join(root, 'reports/coverage-blobs'), { recursive: true });
  await mkdir(path.join(root, 'coverage/foo'), { recursive: true });
  await writeFile(path.join(root, 'reports/junit/foo.xml'), '<testsuite/>\n');
  await writeFile(path.join(root, 'reports/coverage-blobs/foo.json'), '{}\n');
  await writeFile(path.join(root, 'coverage/foo/coverage-final.json'), '{}\n');
  return root;
}

test('artifact names include every collision boundary and sanitize separators', () => {
  assert.equal(
    buildArtifactName({
      runId: '123',
      runAttempt: '2',
      lane: 'test',
      project: 'cli-contract',
    }),
    'ci-evidence-123-2-test-cli-contract',
  );
  assert.equal(
    buildArtifactName({
      runId: '123/unsafe',
      runAttempt: '2',
      lane: 'lint matrix',
      project: 'a/b',
    }),
    'ci-evidence-123-unsafe-2-lint-matrix-a-b',
  );
});

test('source identity comes from the real checkout, not a PR or dispatch event SHA', async () => {
  const root = await fixture();
  try {
    const git = (...args) =>
      execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    git('init', '--quiet');
    git(
      '-c',
      'user.name=Evidence test',
      '-c',
      'user.email=evidence-test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '--quiet',
      '--allow-empty',
      '-m',
      'temporary source identity',
    );
    const expected = git('rev-parse', 'HEAD');
    for (const event of ['pull_request', 'workflow_dispatch']) {
      const result = await collectEvidence(
        {
          rootDir: root,
          evidenceDir: `evidence/${event}`,
          expected: ['junit=reports/junit/foo.xml'],
        },
        {
          environment: { GITHUB_EVENT_NAME: event, GITHUB_SHA: 'f'.repeat(40) },
        },
      );
      assert.equal(result.receipt.checked_out_sha, expected);
      assert.notEqual(result.receipt.checked_out_sha, 'f'.repeat(40));
    }
    await rm(path.join(root, '.git'), { recursive: true, force: true });
    const unavailable = await collectEvidence(
      {
        rootDir: root,
        evidenceDir: 'evidence/no-checkout',
        expected: ['junit=reports/junit/foo.xml'],
      },
      {
        environment: { GITHUB_SHA: 'f'.repeat(40) },
      },
    );
    assert.equal(unavailable.receipt.checked_out_sha, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('collection copies available evidence and records required and optional gaps', async () => {
  const root = await fixture();
  try {
    const result = await collectEvidence(
      {
        rootDir: root,
        lane: 'test',
        project: 'foo',
        evidenceDir: 'ci-evidence/test/foo',
        command: 'pnpm run test --project foo',
        expected: [
          'junit=reports/junit/foo.xml',
          'coverage-blob=reports/coverage-blobs/foo.json',
          'coverage=coverage/foo',
          'log?=logs/missing.log',
        ],
      },
      {
        environment: {
          GITHUB_REPOSITORY: 'suites-dev/blackbox',
          GITHUB_WORKFLOW: 'CI',
          GITHUB_RUN_ID: '42',
          GITHUB_RUN_ATTEMPT: '3',
          GITHUB_EVENT_NAME: 'pull_request',
          GITHUB_SHA: 'deadbeef',
          GITHUB_REF: 'refs/pull/7/merge',
          BLACKBOX_RUN_ID: 'run-123',
        },
        now: (() => {
          let index = 0;
          return () => `2026-01-01T00:00:0${index++}Z`;
        })(),
      },
    );

    assert.equal(result.receipt.result, 'not-run');
    assert.equal(result.receipt.artifact_retention_days, 14);
    assert.equal(result.receipt.lockfile_digest.length, 64);
    assert.deepEqual(result.receipt.blackbox_run_ids, ['run-123']);
    assert.deepEqual(result.receipt.missing_evidence, ['logs/missing.log']);
    assert.deepEqual(result.receipt.missing_required_evidence, []);
    assert.ok(result.receipt.artifact_roots.includes('junit/foo.xml'));
    assert.ok(!result.receipt.artifact_roots.includes('logs/missing.log'));
    assert.equal(result.inventory.expected.length, 4);
    assert.equal(
      await readFile(path.join(root, 'ci-evidence/test/foo/junit/foo.xml'), 'utf8'),
      '<testsuite/>\n',
    );
    assert.equal(
      await readFile(path.join(root, 'ci-evidence/test/foo/receipt.json'), 'utf8')
        .then(JSON.parse)
        .then((receipt) => receipt.artifact_name),
      'ci-evidence-42-3-test-foo',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('aggregate inventory rejects missing project receipts after writing diagnostics', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'blackbox-ci-aggregate-'));
  try {
    await mkdir(path.join(root, 'reports/eslint'), { recursive: true });
    await mkdir(path.join(root, 'logs'), { recursive: true });
    await writeFile(path.join(root, 'reports/eslint/foo.xml'), '<testsuite/>\n');
    await writeFile(path.join(root, 'logs/report.log'), 'foo.xml\n');
    await mkdir(path.join(root, 'input/ci-evidence-42-1-lint-foo'), {
      recursive: true,
    });
    await writeFile(
      path.join(root, 'input/ci-evidence-42-1-lint-foo/receipt.json'),
      JSON.stringify({ lane: 'lint', project: 'foo' }),
    );
    await writeFile(
      path.join(root, 'input/ci-evidence-42-1-lint-foo/inventory.json'),
      JSON.stringify({ missing: [] }),
    );

    await assert.rejects(
      collectEvidence(
        {
          rootDir: root,
          lane: 'lint',
          project: 'merged',
          evidenceDir: 'ci-evidence/lint/merged',
          expected: ['junit-dir=reports/eslint', 'log=logs/report.log'],
          inputRoot: 'input',
          expectedProjects: ['foo', 'missing'],
          result: 'failure',
        },
        { environment: { GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '1' } },
      ),
      (error) => {
        const result = error.result;
        assert.deepEqual(result.inventory.missing_projects, ['missing']);
        assert.equal(result.inventory.input_artifacts.length, 1);
        assert.deepEqual(result.receipt.missing_evidence, ['project:missing']);
        return true;
      },
    );
    assert.equal(
      await readFile(
        path.join(root, 'ci-evidence/lint/merged/inputs/ci-evidence-42-1-lint-foo/receipt.json'),
        'utf8',
      )
        .then(JSON.parse)
        .then((receipt) => receipt.project),
      'foo',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('command wrapper keeps a failing exit code and captures diagnostics', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'blackbox-ci-command-'));
  try {
    const result = await runCommand({
      rootDir: root,
      lane: 'test',
      project: 'broken',
      evidenceDir: 'ci-evidence/test/broken',
      command: [
        process.execPath,
        '-e',
        "console.error('controlled failure'); console.log('BLACKBOX_RUN_ID=run-from-log'); process.exit(7)",
      ],
    });
    assert.equal(result.result, 'failed');
    assert.equal(result.exit_code, 7);
    assert.deepEqual(result.blackbox_run_ids, ['run-from-log']);
    assert.match(
      await readFile(path.join(root, 'ci-evidence/test/broken/logs/command.log'), 'utf8'),
      /controlled failure/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('command wrapper records lifecycle diagnostics when a successful command is silent', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'blackbox-ci-silent-command-'));
  try {
    const result = await runCommand({
      rootDir: root,
      lane: 'test',
      project: 'silent',
      evidenceDir: 'ci-evidence/test/silent',
      command: [process.execPath, '-e', 'process.exit(0)'],
    });
    assert.equal(result.result, 'passed');
    const log = await readFile(path.join(root, 'ci-evidence/test/silent/logs/command.log'), 'utf8');
    assert.match(log, /^\[ci-evidence\] started=/m);
    assert.match(log, /^\[ci-evidence\] ended=.*exit_code=0/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a child that self-signals cannot be reported as passed without wrapper cancellation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'blackbox-ci-self-signal-'));
  try {
    const result = await runCommand({
      rootDir: root,
      lane: 'test',
      project: 'self-signal',
      evidenceDir: 'ci-evidence/test/self-signal',
      command: [process.execPath, '-e', "process.kill(process.pid, 'SIGKILL')"],
    });
    assert.equal(result.result, 'failed');
    assert.equal(result.exit_code, 1);
    assert.equal(result.signal, 'SIGKILL');
    const persisted = JSON.parse(
      await readFile(path.join(root, 'ci-evidence/test/self-signal/run-result.json'), 'utf8'),
    );
    assert.equal(persisted.result, 'failed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('spawn ENOENT removes cancellation listeners', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'blackbox-ci-enoent-'));
  const before = Object.fromEntries(
    ['SIGINT', 'SIGTERM'].map((signal) => [signal, process.listenerCount(signal)]),
  );
  try {
    const result = await runCommand({
      rootDir: root,
      evidenceDir: 'evidence',
      command: [`missing-ci-evidence-command-${process.pid}`],
    });
    assert.equal(result.result, 'failed');
    assert.match(result.error, /ENOENT/);
    for (const signal of ['SIGINT', 'SIGTERM']) {
      assert.equal(process.listenerCount(signal), before[signal], signal);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`wrapper ${signal} cancellation writes failure evidence and removes descendants`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'blackbox-ci-cancel-'));
    let wrapper;
    let childPid;
    let grandchildPid;
    try {
      const grandchild = [
        "process.on('SIGTERM',()=>process.exit(0))",
        "process.send('ready')",
        'setTimeout(()=>process.exit(2),10000)',
      ].join(';');
      const program = [
        "const {spawn}=require('node:child_process')",
        `const grandchild=spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:['ignore','inherit','inherit','ipc']})`,
        "process.on('SIGTERM',()=>process.exit(0))",
        "grandchild.once('message',()=>console.log('READY child='+process.pid+' grandchild='+grandchild.pid+' token='+process.env.API_TOKEN))",
        'setTimeout(()=>process.exit(2),10000)',
      ].join(';');
      wrapper = spawn(
        process.execPath,
        [
          scriptPath,
          'run',
          '--lane',
          'test',
          '--project',
          'cancel',
          '--evidence-dir',
          'evidence',
          '--teardown-timeout-ms',
          '250',
          '--',
          process.execPath,
          '-e',
          program,
        ],
        {
          cwd: root,
          env: { ...process.env, API_TOKEN: 'cancel-secret' },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      const ready = await waitForLine(wrapper.stdout, /READY child=(\d+) grandchild=(\d+)/);
      childPid = Number(ready[1]);
      grandchildPid = Number(ready[2]);
      wrapper.kill(signal);
      const exit = await waitForExit(wrapper);
      assert.deepEqual(exit, { code: signal === 'SIGINT' ? 130 : 143, signal: null });
      const result = JSON.parse(
        await readFile(path.join(root, 'evidence/run-result.json'), 'utf8'),
      );
      assert.equal(result.result, 'failed');
      assert.equal(result.signal, signal);
      assert.equal(result.cleanup.term_sent, true);
      const log = await readFile(path.join(root, 'evidence/logs/command.log'), 'utf8');
      assert.match(log, /READY child=/);
      assert.doesNotMatch(log, /cancel-secret/);
      assert.match(log, /exit_code=(130|143)/);
      await eventuallyDead(childPid);
      await eventuallyDead(grandchildPid);
    } finally {
      await stopWrapper(wrapper);
      for (const pid of [childPid, grandchildPid]) {
        if (pidIsAlive(pid)) process.kill(pid, 'SIGKILL');
      }
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('wrapper escalates stubborn child and grandchild cancellation to bounded SIGKILL', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'blackbox-ci-stubborn-'));
  let wrapper;
  let childPid;
  let grandchildPid;
  try {
    const stubborn =
      "process.on('SIGTERM',()=>{});process.send('ready');setTimeout(()=>process.exit(2),10000)";
    const program = [
      "const {spawn}=require('node:child_process')",
      `const grandchild=spawn(process.execPath,['-e',${JSON.stringify(stubborn)}],{stdio:['ignore','inherit','inherit','ipc']})`,
      "process.on('SIGTERM',()=>{})",
      "grandchild.once('message',()=>console.log('READY child='+process.pid+' grandchild='+grandchild.pid))",
      'setTimeout(()=>process.exit(2),10000)',
    ].join(';');
    wrapper = spawn(
      process.execPath,
      [
        scriptPath,
        'run',
        '--lane',
        'test',
        '--project',
        'stubborn',
        '--evidence-dir',
        'evidence',
        '--teardown-timeout-ms',
        '200',
        '--',
        process.execPath,
        '-e',
        program,
      ],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const ready = await waitForLine(wrapper.stdout, /READY child=(\d+) grandchild=(\d+)/);
    childPid = Number(ready[1]);
    grandchildPid = Number(ready[2]);
    wrapper.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 30));
    wrapper.kill('SIGTERM');
    assert.deepEqual(await waitForExit(wrapper), { code: 143, signal: null });
    const result = JSON.parse(await readFile(path.join(root, 'evidence/run-result.json'), 'utf8'));
    assert.equal(result.result, 'failed');
    assert.equal(result.cleanup.kill_sent, true);
    assert.equal(result.cleanup.ok, true);
    await eventuallyDead(childPid);
    await eventuallyDead(grandchildPid);
  } finally {
    await stopWrapper(wrapper);
    for (const pid of [childPid, grandchildPid]) {
      if (pidIsAlive(pid)) process.kill(pid, 'SIGKILL');
    }
    await rm(root, { recursive: true, force: true });
  }
});

test('teardown cancellation keeps an exited parent failure while a descendant holds pipes', async () => {
  if (process.platform === 'win32') return;
  const root = await mkdtemp(path.join(tmpdir(), 'blackbox-ci-exited-parent-'));
  let wrapper;
  let grandchildPid;
  try {
    const grandchild =
      "process.on('SIGTERM',()=>{});process.send('ready');setTimeout(()=>process.exit(2),10000)";
    const parent = [
      "const {spawn}=require('node:child_process')",
      `const child=spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:['ignore','inherit','inherit','ipc']})`,
      "child.once('message',()=>{console.log('READY grandchild='+child.pid);process.exit(7)})",
      'setTimeout(()=>process.exit(2),10000)',
    ].join(';');
    wrapper = spawn(
      process.execPath,
      [
        scriptPath,
        'run',
        '--evidence-dir',
        'evidence',
        '--teardown-timeout-ms',
        '500',
        '--',
        process.execPath,
        '-e',
        parent,
      ],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const ready = await waitForLine(wrapper.stdout, /READY grandchild=(\d+)/);
    grandchildPid = Number(ready[1]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    wrapper.kill('SIGINT');
    assert.deepEqual(await waitForExit(wrapper, 4_000), { code: 7, signal: null });
    const result = JSON.parse(await readFile(path.join(root, 'evidence/run-result.json'), 'utf8'));
    assert.equal(result.signal, 'SIGINT');
    assert.equal(result.exit_code, 7);
    assert.equal(result.cleanup.kill_sent, true);
    await eventuallyDead(grandchildPid);
  } finally {
    await stopWrapper(wrapper);
    if (pidIsAlive(grandchildPid)) process.kill(grandchildPid, 'SIGKILL');
    await rm(root, { recursive: true, force: true });
  }
});

test('collector preserves configured test identifiers when the command result has none', async () => {
  const root = await fixture();
  try {
    await runCommand({
      rootDir: root,
      lane: 'test',
      project: 'foo',
      evidenceDir: 'ci-evidence/test/foo',
      command: [process.execPath, '-e', 'process.exit(0)'],
    });

    const result = await collectEvidence({
      rootDir: root,
      lane: 'test',
      project: 'foo',
      evidenceDir: 'ci-evidence/test/foo',
      testCaseIdentifiers: 'package:foo\nlane:test',
    });

    assert.deepEqual(result.receipt.test_case_identifiers, ['package:foo', 'lane:test']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stored command logs redact environment secrets and credential-shaped output', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'blackbox-ci-redaction-'));
  try {
    let mirrored = '';
    const output = { write: (chunk) => ((mirrored += chunk.toString()), true) };
    await runCommand(
      {
        rootDir: root,
        lane: 'test',
        project: 'redaction',
        evidenceDir: 'ci-evidence/test/redaction',
        command: [
          process.execPath,
          '-e',
          "console.log('token=visible-secret Authorization: Bearer abc')",
        ],
      },
      {
        environment: { ...process.env, API_TOKEN: 'visible-secret' },
        stdout: output,
        stderr: output,
      },
    );
    const log = await readFile(
      path.join(root, 'ci-evidence/test/redaction/logs/command.log'),
      'utf8',
    );
    assert.doesNotMatch(log, /visible-secret|Bearer abc/);
    assert.match(log, /token=\*\*\* Authorization: Bearer \*\*\*/);
    assert.doesNotMatch(mirrored, /visible-secret|Bearer abc/);
    assert.equal(redactSecrets('password=hunter2', {}), 'password=***');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('collector rejects traversal, absolute paths, and empty required evidence', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'blackbox-ci-paths-'));
  try {
    await writeFile(path.join(root, 'empty.xml'), '');
    for (const expected of ['junit=../outside.xml', `junit=${path.join(root, 'empty.xml')}`]) {
      await assert.rejects(
        collectEvidence({ rootDir: root, evidenceDir: 'evidence/out', expected: [expected] }),
        /workspace-relative|contained by the workspace/,
      );
    }
    await assert.rejects(
      collectEvidence({
        rootDir: root,
        evidenceDir: 'evidence/out',
        expected: ['junit=empty.xml'],
      }),
      /Required CI evidence is incomplete/,
    );
    const receipt = JSON.parse(
      await readFile(path.join(root, 'evidence/out/receipt.json'), 'utf8'),
    );
    assert.equal(receipt.collection.status, 'partial');
    assert.deepEqual(receipt.missing_required_evidence, ['junit/empty.xml']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('required-evidence failures do not mislabel optional gaps as blockers', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'blackbox-ci-required-message-'));
  try {
    await assert.rejects(
      collectEvidence({
        rootDir: root,
        evidenceDir: 'evidence/out',
        expected: ['coverage?=missing-optional', 'junit=missing-required'],
      }),
      (error) => {
        assert.match(error.message, /junit\/missing-required/);
        assert.doesNotMatch(error.message, /missing-optional/);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('collector rejects evidence and aggregate inputs that traverse symlinks', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'blackbox-ci-symlink-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'blackbox-ci-symlink-outside-'));
  try {
    await writeFile(path.join(outside, 'result.xml'), '<testsuite/>\n');
    await symlink(outside, path.join(root, 'linked'));
    await assert.rejects(
      collectEvidence({
        rootDir: root,
        evidenceDir: 'evidence/out',
        expected: ['junit=linked/result.xml'],
      }),
      /symbolic links/,
    );
    await assert.rejects(
      collectEvidence({
        rootDir: root,
        evidenceDir: 'evidence/out',
        inputRoot: 'linked',
        expectedProjects: ['missing'],
        expected: ['log?=missing.log'],
      }),
      /symbolic links/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('receipt records working directory, test identifiers, and structured outcomes', async () => {
  const root = await fixture();
  try {
    await mkdir(path.join(root, 'ci-evidence/test/foo/logs'), { recursive: true });
    await writeFile(
      path.join(root, 'ci-evidence/test/foo/logs/command.log'),
      'unrelated_run_id=github-1\nBLACKBOX_RUN_ID=bb-42\n',
    );
    const result = await collectEvidence({
      rootDir: root,
      lane: 'test',
      project: 'foo',
      evidenceDir: 'ci-evidence/test/foo',
      workingDirectory: 'packages/foo',
      testCaseIdentifiers: 'case-a\ncase-b',
      setupResult: 'success',
      uploadResult: 'skipped',
    });
    assert.equal(result.receipt.working_directory, 'packages/foo');
    assert.deepEqual(result.receipt.test_case_identifiers, ['case-a', 'case-b']);
    assert.deepEqual(result.receipt.outcomes, {
      setup: 'success',
      command: 'not-run',
      upload: 'skipped',
    });
    assert.deepEqual(result.receipt.blackbox_run_ids, ['bb-42']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('composite action always uploads diagnostics and then enforces both outcomes', async () => {
  const action = YAML.parse(
    await readFile(new URL('../actions/ci-evidence/action.yml', import.meta.url), 'utf8'),
  );
  const steps = action.runs.steps;
  assert.equal(steps[0].if, 'always()');
  assert.equal(steps[0]['continue-on-error'], true);
  assert.equal(steps[1].if, 'always()');
  assert.equal(steps[1]['continue-on-error'], true);
  assert.equal(steps[1].with['if-no-files-found'], 'error');
  assert.equal(steps[2].if, 'always()');
  assert.match(steps[2].run, /COLLECT_OUTCOME.*UPLOAD_OUTCOME/s);
});

test('aggregate jobs provision checkout and Node before invoking the evidence action', async () => {
  for (const workflowName of ['test-packages.yml', 'lint-packages.yml']) {
    const workflow = YAML.parse(
      await readFile(new URL(`../workflows/${workflowName}`, import.meta.url), 'utf8'),
    );
    const aggregate = workflow.jobs.coverage || workflow.jobs.report;
    const checkout = aggregate.steps.findIndex((step) => step.uses === 'actions/checkout@v5');
    const localAction = aggregate.steps.findIndex(
      (step) => step.uses === './.github/actions/ci-evidence',
    );
    assert.ok(checkout >= 0 && checkout < localAction, workflowName);
    const nodeSetup = aggregate.steps.findIndex(
      (step) => step.uses === 'actions/setup-node@v6' || step.uses === './.github/actions/setup',
    );
    assert.ok(nodeSetup > checkout && nodeSetup < localAction, `${workflowName}: Node setup`);
    assert.equal(
      aggregate.steps[localAction].with['setup-result'],
      '${{ steps.setup.outcome }}',
      `${workflowName}: setup outcome retained`,
    );
  }
});
