#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const wrapper = path.join(root, '.github/scripts/ci-evidence.mjs');
const testCase = 'ci-evidence-hosted-sigterm';
const readyTimeoutMs = 15_000;
const wrapperTimeoutMs = 10_000;
const childTimeoutMs = 3_000;

function fail(message) {
  throw new Error(message);
}

function evidenceRootFor(value) {
  if (!value || path.isAbsolute(value)) fail('--evidence-dir must be workspace-relative');
  const resolved = path.resolve(root, value);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail('--evidence-dir must stay inside the workspace');
  }
  return resolved;
}

function proofPathFor(evidenceRoot) {
  return `${evidenceRoot}-proof.json`;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function waitForClose(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`wrapper did not close within ${timeoutMs}ms`)),
      timeoutMs,
    );
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function waitUntil(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (await predicate()) return true;
  fail(message);
}

function signal(pid, name) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, name);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

async function processIsRunning(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  if (process.platform === 'linux') {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(') ') + 2).split(' ');
      return fields[0] !== 'Z';
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    throw error;
  }
}

async function terminateOwnedProcesses(wrapperPid, childPid) {
  if (Number.isSafeInteger(wrapperPid)) signal(wrapperPid, 'SIGTERM');
  if (Number.isSafeInteger(childPid) && process.platform !== 'win32') {
    try {
      process.kill(-childPid, 'SIGTERM');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  } else if (Number.isSafeInteger(childPid)) {
    signal(childPid, 'SIGTERM');
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  if (Number.isSafeInteger(wrapperPid) && (await processIsRunning(wrapperPid))) {
    signal(wrapperPid, 'SIGKILL');
  }
  if (Number.isSafeInteger(childPid) && (await processIsRunning(childPid))) {
    if (process.platform !== 'win32') {
      try {
        process.kill(-childPid, 'SIGKILL');
      } catch (error) {
        if (error?.code !== 'ESRCH') throw error;
      }
    } else {
      signal(childPid, 'SIGKILL');
    }
  }
}

async function run(evidenceDir, evidenceRoot) {
  const nonce = randomUUID();
  const pidDirectory = await mkdtemp(path.join(os.tmpdir(), 'blackbox-ci-signal-'));
  const pidFile = path.join(pidDirectory, 'child.pid');
  let wrapperChild;
  let childPid;
  let wrapperResult;
  let signalSent = false;
  let transcript = '';
  try {
    await mkdir(evidenceRoot, { recursive: true });
    const childSource = [
      "const fs = require('node:fs');",
      'const pidFile = process.env.BLACKBOX_CI_SIGNAL_PID_FILE;',
      'const nonce = process.env.BLACKBOX_CI_SIGNAL_NONCE;',
      "fs.writeFileSync(pidFile, String(process.pid), { flag: 'wx' });",
      'process.stdout.write(`BLACKBOX_CI_SIGNAL_READY ${nonce} pid=${process.pid}\\n`);',
      'setInterval(() => {}, 1000);',
    ].join(' ');
    wrapperChild = spawn(
      process.execPath,
      [
        wrapper,
        'run',
        '--lane',
        'proof',
        '--project',
        'wrapper-sigterm',
        '--evidence-dir',
        evidenceDir,
        '--test-case-identifiers',
        testCase,
        '--teardown-timeout-ms',
        '2000',
        '--',
        process.execPath,
        '-e',
        childSource,
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          BLACKBOX_CI_SIGNAL_NONCE: nonce,
          BLACKBOX_CI_SIGNAL_PID_FILE: pidFile,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    const wrapperClosed = waitForClose(wrapperChild, readyTimeoutMs + wrapperTimeoutMs);
    wrapperClosed.catch(() => {});
    let readyResolve;
    let readyReject;
    const ready = new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    const consume = (stream, output) => {
      stream.on('data', (chunk) => {
        output.write(chunk);
        if (transcript.length < 16_384) transcript += chunk.toString('utf8');
        const match = transcript.match(new RegExp(`BLACKBOX_CI_SIGNAL_READY ${nonce} pid=(\\d+)`));
        if (match) readyResolve(Number(match[1]));
      });
    };
    consume(wrapperChild.stdout, process.stdout);
    consume(wrapperChild.stderr, process.stderr);
    wrapperChild.once('error', readyReject);
    const readyTimer = setTimeout(
      () => readyReject(new Error('child did not report ready in time')),
      readyTimeoutMs,
    );
    try {
      childPid = await ready;
    } finally {
      clearTimeout(readyTimer);
    }
    const recordedPid = Number((await readFile(pidFile, 'utf8')).trim());
    if (recordedPid !== childPid) fail('child ready marker and PID file disagree');
    if (wrapperChild.pid === childPid) fail('wrapper and child PID unexpectedly match');

    signalSent = signal(wrapperChild.pid, 'SIGTERM');
    if (!signalSent) fail('could not send SIGTERM to the owned wrapper process');
    wrapperResult = await wrapperClosed;
    await waitUntil(
      () => processIsRunning(childPid).then((running) => !running),
      childTimeoutMs,
      `child process ${childPid} remained alive after wrapper cleanup`,
    );

    const runResult = await readJson(path.join(evidenceRoot, 'run-result.json'));
    const proof = {
      schema_version: 1,
      test_case_identifier: testCase,
      wrapper_pid: wrapperChild.pid,
      child_pid: childPid,
      child_pid_file_verified: true,
      child_gone_after_wrapper_close: true,
      sigterm_sent_to_wrapper: signalSent,
      wrapper_process_exit_code: wrapperResult.code,
      wrapper_process_signal: wrapperResult.signal,
      expected_run_result: 'failed',
      expected_exit_code: 143,
      expected_signal: 'SIGTERM',
      checked_out_sha: process.env.GITHUB_SHA || null,
      event: process.env.GITHUB_EVENT_NAME || 'local',
      workflow_run_id: process.env.GITHUB_RUN_ID || null,
      run_attempt: process.env.GITHUB_RUN_ATTEMPT || null,
      run_result: {
        result: runResult.result,
        exit_code: runResult.exit_code,
        signal: runResult.signal,
        cleanup_ok: runResult.cleanup?.ok === true,
        streams_flushed: runResult.streams_flushed === true,
      },
    };
    await writeFile(proofPathFor(evidenceRoot), `${JSON.stringify(proof, null, 2)}\n`, {
      flag: 'wx',
    });
    process.stdout.write(`Verified SIGTERM wrapper proof for child PID ${childPid}.\n`);
  } catch (error) {
    if (wrapperChild) {
      if (!Number.isSafeInteger(childPid)) {
        try {
          childPid = Number((await readFile(pidFile, 'utf8')).trim());
        } catch {
          childPid = undefined;
        }
      }
      await terminateOwnedProcesses(wrapperChild.pid, childPid);
    }
    throw error;
  } finally {
    await rm(pidDirectory, { recursive: true, force: true });
  }
}

async function verify(evidenceDir, evidenceRoot) {
  const runResult = await readJson(path.join(evidenceRoot, 'run-result.json'));
  const proof = await readJson(proofPathFor(evidenceRoot));
  const receipt = await readJson(path.join(evidenceRoot, 'receipt.json'));
  const inventory = await readJson(path.join(evidenceRoot, 'inventory.json'));
  const required = (condition, message) => {
    if (!condition) fail(message);
  };
  required(proof.test_case_identifier === testCase, 'proof has the wrong test-case identifier');
  required(proof.sigterm_sent_to_wrapper === true, 'proof did not signal its wrapper');
  required(proof.child_pid_file_verified === true, 'proof did not verify the child PID file');
  required(proof.child_gone_after_wrapper_close === true, 'proof did not confirm child cleanup');
  required(
    Number.isSafeInteger(proof.wrapper_pid) && proof.wrapper_pid > 0,
    'proof has no wrapper PID',
  );
  required(Number.isSafeInteger(proof.child_pid) && proof.child_pid > 0, 'proof has no child PID');
  required(proof.wrapper_pid !== proof.child_pid, 'proof wrapper and child PIDs are identical');
  required(proof.wrapper_process_exit_code === 143, 'wrapper did not return exit code 143');
  required(proof.wrapper_process_signal === null, 'wrapper itself was externally signaled');
  required(runResult.result === 'failed', 'wrapped command was not retained as failed');
  required(runResult.exit_code === 143, 'run result did not retain exit code 143');
  required(runResult.signal === 'SIGTERM', 'run result did not retain SIGTERM');
  required(runResult.cleanup?.ok === true, 'run result reports failed child cleanup');
  required(runResult.streams_flushed === true, 'run result reports unflushed streams');
  required(
    runResult.test_case_identifiers?.includes(testCase),
    'run result lost test-case identifier',
  );
  required(
    proof.run_result?.result === runResult.result &&
      proof.run_result?.exit_code === runResult.exit_code &&
      proof.run_result?.signal === runResult.signal &&
      proof.run_result?.cleanup_ok === runResult.cleanup?.ok &&
      proof.run_result?.streams_flushed === runResult.streams_flushed,
    'proof summary differs from the retained run result',
  );
  required(
    receipt.lane === 'proof' && receipt.project === 'wrapper-sigterm',
    'evidence receipt identity mismatch',
  );
  required(
    receipt.result === 'failed' && receipt.exit_code === 143,
    'evidence receipt lost failed run status',
  );
  required(receipt.signal === 'SIGTERM', 'evidence receipt lost SIGTERM');
  required(receipt.collection?.status === 'complete', 'evidence collection is incomplete');
  required(
    receipt.test_case_identifiers?.includes(testCase),
    'evidence receipt lost test-case identifier',
  );
  if (process.env.GITHUB_SHA) {
    required(
      receipt.checked_out_sha === process.env.GITHUB_SHA,
      'receipt checked-out SHA differs from workflow SHA',
    );
    required(
      proof.checked_out_sha === process.env.GITHUB_SHA,
      'proof checked-out SHA differs from workflow SHA',
    );
  }
  if (process.env.GITHUB_EVENT_NAME) {
    required(
      receipt.event === process.env.GITHUB_EVENT_NAME,
      'receipt event differs from workflow event',
    );
    required(
      proof.event === process.env.GITHUB_EVENT_NAME,
      'proof event differs from workflow event',
    );
  }
  required(
    process.env.SIGNAL_EVIDENCE_OUTCOME === 'success',
    'evidence collection or upload did not succeed',
  );
  const expected = inventory.expected || [];
  for (const [kind, sourcePath] of [
    ['log', `${evidenceDir.replaceAll(path.sep, '/')}/logs/command.log`],
    ['proof', `${evidenceDir.replaceAll(path.sep, '/')}-proof.json`],
  ]) {
    required(
      expected.some(
        (entry) =>
          entry.kind === kind && entry.source_path === sourcePath && entry.status === 'present',
      ),
      `inventory is missing present ${kind} evidence`,
    );
  }
  required((inventory.missing || []).length === 0, 'evidence inventory reports missing artifacts');
  required(
    (receipt.artifact_roots || []).includes('run-result.json'),
    'receipt omits run result artifact',
  );
  required((receipt.artifact_roots || []).includes('logs/'), 'receipt omits command log artifact');
  const proofArtifactPath = `outputs/${path.basename(proofPathFor(evidenceRoot))}`;
  required(
    (receipt.artifact_roots || []).includes(proofArtifactPath),
    'receipt omits signal proof artifact',
  );
  process.stdout.write(`Verified uploaded SIGTERM evidence for ${receipt.artifact_name}.\n`);
}

async function main() {
  const [operation, flag, evidenceDir] = process.argv.slice(2);
  if (!['run', 'verify'].includes(operation) || flag !== '--evidence-dir' || !evidenceDir) {
    fail(
      'Usage: ci-evidence-signal-proof.mjs <run|verify> --evidence-dir <workspace-relative-path>',
    );
  }
  const evidenceRoot = evidenceRootFor(evidenceDir);
  if (operation === 'run') {
    await run(evidenceDir, evidenceRoot);
    return;
  }
  await verify(evidenceDir, evidenceRoot);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
