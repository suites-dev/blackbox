import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { recoverSandbox } from '@suites/blackbox-sandbox';

import {
  assertSameTree,
  featureError,
  featureGolden,
  incompleteFeatureGolden,
  sandboxRecords,
  snapshotTree,
  verifyFinishedSandbox,
  verifyRetainedAttempt,
  verifyRunReport,
  writeFeatureComparison,
} from './playwright-features-proof.mjs';

const execute = promisify(execFile);
const consumerRoot = dirname(fileURLToPath(import.meta.url));
const resultsRoot = join(consumerRoot, 'test-results', 'features');
const outputDirectory = join(resultsRoot, 'output');
const experiments = join(consumerRoot, '.blackbox', 'experiments');
const history = [];
const observedRuns = [];
let child;
let childKillTimer;
let interrupted = false;

function stopChild() {
  const running = child;
  if (running === undefined) return;
  running.kill('SIGINT');
  childKillTimer ??= setTimeout(() => running.kill('SIGKILL'), 45_000);
  childKillTimer.unref();
}

function ownedPath(path, root) {
  const difference = relative(root, path);
  assert(
    difference !== '' && !difference.startsWith('..') && !isAbsolute(difference),
    `Feature artifact escaped owned output: ${path}`,
  );
  return path;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return false;
  }
}

async function absentDockerResources(projectName) {
  for (const arguments_ of [
    ['ps', '--all', '--quiet'],
    ['network', 'ls', '--quiet'],
    ['volume', 'ls', '--quiet'],
  ]) {
    const { stdout } = await execute('docker', [
      ...arguments_,
      '--filter',
      `label=com.docker.compose.project=${projectName}`,
    ]);
    assert.equal(stdout.trim(), '', `Feature sandbox leaked Docker resources: ${projectName}`);
  }
}

function runPlaywright(mode, directory) {
  assert(!interrupted, 'Playwright features interrupted before next invocation');
  const log = createWriteStream(join(directory, 'execution.txt'), { flags: 'wx' });
  const arguments_ = ['test', '--config', join(consumerRoot, 'playwright-features.config.ts')];
  if (mode !== 'retained-first') arguments_.push('retention.spec.ts');
  return new Promise((resolve, reject) => {
    let failure;
    let closed = false;
    child = spawn(join(consumerRoot, 'node_modules', '.bin', 'playwright'), arguments_, {
      cwd: consumerRoot,
      env: {
        ...process.env,
        BLACKBOX_FEATURE_MODE: mode,
        BLACKBOX_FEATURE_RESULTS_ROOT: directory,
        BLACKBOX_FEATURE_OUTPUT_DIR: outputDirectory,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk) => {
        if (failure === undefined) log.write(chunk);
        process.stdout.write(chunk);
      });
    }
    child.once('error', (error) => {
      failure = error;
    });
    child.once('close', (code, signal) => {
      closed = true;
      child = undefined;
      clearTimeout(childKillTimer);
      childKillTimer = undefined;
      if (failure !== undefined) {
        log.destroy();
        reject(failure);
        return;
      }
      log.end((error) => {
        if (error !== undefined && error !== null) reject(error);
        else if (signal !== null || interrupted)
          reject(new Error(`Playwright interrupted: ${signal}`));
        else resolve(code);
      });
    });
    log.once('error', (error) => {
      failure = error;
      if (closed) reject(error);
      else stopChild();
    });
  });
}

function attemptDocument(attempts, sandboxId) {
  const documents = attempts
    .flatMap(({ attachments }) => attachments)
    .filter(({ name }) => name === 'blackbox-attempt')
    .map(({ body }) => Buffer.from(body, 'base64').toString('utf8'));
  const matching = documents.filter(
    (document) => JSON.parse(document).identity.sandboxId === sandboxId,
  );
  assert.equal(matching.length, 1, `No unique attachment for ${sandboxId}`);
  return matching[0];
}

async function inspectRun(mode, directory, exitCode) {
  const report = JSON.parse(await readFile(join(directory, 'results.json'), 'utf8'));
  const attempts = verifyRunReport(report, mode, exitCode);
  const names = mode === 'retained-first' ? ['retention', 'setup-exec'] : ['retention'];
  const receiptsDirectory = join(directory, 'receipts');
  await mkdir(receiptsDirectory, { recursive: false });
  const receipts = await Promise.all(
    names.map(async (name) => {
      const attachments = attempts
        .flatMap((attempt) => attempt.attachments)
        .filter((attachment) => attachment.name === `blackbox-feature-receipt:${name}`);
      assert.equal(attachments.length, 1, `No unique ${name} feature receipt attachment`);
      assert.equal(attachments[0].contentType, 'application/json');
      assert.equal(
        typeof attachments[0].body,
        'string',
        'Feature receipt must be an inline attachment',
      );
      const text = Buffer.from(attachments[0].body, 'base64').toString('utf8');
      const receipt = JSON.parse(text);
      await writeFile(join(receiptsDirectory, `${name}.json`), text, { flag: 'wx' });
      return receipt;
    }),
  );
  const records = await sandboxRecords(outputDirectory);
  assert.equal(records.length, receipts.length, 'Unexpected physical feature sandbox count');
  assert.equal(new Set(records.map(({ value }) => value.sandboxId)).size, receipts.length);
  const retained = [];
  for (const receipt of receipts) {
    ownedPath(receipt.artifactDirectory, outputDirectory);
    const source = await verifyFinishedSandbox(receipt.artifactDirectory, receipt);
    await absentDockerResources(source.record.projectName);
    const destination = ownedPath(join(experiments, receipt.sandboxId), experiments);
    if (mode === 'default-off') {
      assert.equal(
        await exists(destination),
        false,
        'Default-off unexpectedly retained an attempt',
      );
    } else if (mode === 'write-failure') {
      assert.equal(
        await readFile(join(destination, 'attempt.json'), 'utf8'),
        receipt.collisionSentinel,
        'Retention failure overwrote existing evidence',
      );
    } else {
      retained.push({
        sandboxId: receipt.sandboxId,
        directory: destination,
        ...(await verifyRetainedAttempt(
          destination,
          receipt,
          attemptDocument(attempts, receipt.sandboxId),
        )),
      });
    }
  }
  return { mode, exitCode, receipts, retained, specs: attempts.length };
}

async function run(mode) {
  const observed = { mode, status: 'started' };
  observedRuns.push(observed);
  const directory = join(resultsRoot, mode);
  await mkdir(directory, { recursive: false });
  let result;
  let failure;
  try {
    const exitCode = await runPlaywright(mode, directory);
    observed.exitCode = exitCode;
    observed.status = 'verification-pending';
    await writeFile(
      join(directory, 'run-result.json'),
      JSON.stringify({ mode, exitCode }, null, 2),
    );
    result = await inspectRun(mode, directory, exitCode);
    observed.status = 'verified';
    await writeFile(join(directory, 'receipt.json'), JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    failure = error;
    observed.status = 'failed';
    observed.error = featureError(error);
    throw error;
  } finally {
    // Keep every physical record for recovery and diagnosis before another CLI run
    // clears the shared output directory, including failed acquisition attempts.
    const archived = join(directory, 'output');
    try {
      if (await exists(outputDirectory)) {
        await cp(outputDirectory, archived, { recursive: true, errorOnExist: true, force: false });
        history.push(archived);
      }
    } catch (error) {
      throw failure === undefined
        ? error
        : new AggregateError([failure, error], 'Feature run and output archive failed');
    }
  }
}

async function recoverOwnedSandboxes() {
  const recovered = new Set();
  const recoveries = [];
  const failures = [];
  const roots = [...history, ...((await exists(outputDirectory)) ? [outputDirectory] : [])];
  for (const root of roots) {
    for (const { path, value } of await sandboxRecords(root)) {
      if (recovered.has(value.sandboxId)) continue;
      recovered.add(value.sandboxId);
      try {
        const result = await recoverSandbox({
          recordDirectory: dirname(path),
          sandboxId: value.sandboxId,
          timeoutMs: 60_000,
        });
        await absentDockerResources(value.projectName);
        recoveries.push({ sandboxId: value.sandboxId, projectName: value.projectName, result });
      } catch (error) {
        failures.push(error);
      }
    }
  }
  await writeFile(join(resultsRoot, 'recovery.json'), JSON.stringify({ recoveries }, null, 2));
  if (failures.length > 0) throw new AggregateError(failures, 'Feature sandbox recovery failed');
  return { recoveries };
}

function interrupt() {
  interrupted = true;
  stopChild();
}
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);

await mkdir(resultsRoot, { recursive: false });
let primaryError;
let proof;
let recovery;
try {
  const first = await run('retained-first');
  const sentinel = join(outputDirectory, 'first-run-output-sentinel.txt');
  await writeFile(sentinel, 'Playwright must clear this on its next invocation');
  const second = await run('retained-second');
  assert.equal(
    await exists(sentinel),
    false,
    'Second Playwright invocation did not clear outputDir',
  );
  const firstIds = first.receipts.map(({ sandboxId }) => sandboxId);
  assert(
    !firstIds.includes(second.receipts[0].sandboxId),
    'Successive runs reused a sandbox identity',
  );
  for (const prior of first.retained) {
    assertSameTree(
      await snapshotTree(prior.directory),
      prior.snapshot,
      'Second Playwright run altered the previous retained attempt',
    );
  }
  for (const receipt of first.receipts) {
    assert.equal(
      await exists(join(receipt.artifactDirectory, `${receipt.sandboxId}.json`)),
      false,
      'Old normal-output sandbox record survived the second run',
    );
  }
  const beforeDefault = await snapshotTree(experiments);
  const defaultOff = await run('default-off');
  assertSameTree(
    await snapshotTree(experiments),
    beforeDefault,
    'Default-off changed the retained experiments tree',
  );
  const writeFailure = await run('write-failure');
  proof = {
    kind: 'playwright-feature-e2e-proof',
    runs: [first, second, defaultOff, writeFailure],
    outputClearedBetweenRuns: true,
    retainedBytesSurvived: true,
    defaultOffUnchanged: true,
    writeFailurePreserved: true,
  };
} catch (error) {
  primaryError = error;
} finally {
  try {
    recovery = await recoverOwnedSandboxes();
  } catch (error) {
    primaryError = primaryError === undefined ? error : new AggregateError([primaryError, error]);
  }
  try {
    // Retain partial or rejected archives too, before the outer consumer cleanup.
    if (await exists(experiments)) {
      await cp(experiments, join(resultsRoot, 'retained'), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    }
  } catch (error) {
    primaryError = primaryError === undefined ? error : new AggregateError([primaryError, error]);
  }
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', interrupt);
}
try {
  if (primaryError === undefined && interrupted) {
    primaryError = new Error('Playwright features interrupted');
  }
  let actual;
  try {
    actual =
      primaryError === undefined
        ? featureGolden(proof, recovery)
        : incompleteFeatureGolden(observedRuns, recovery, primaryError);
  } catch (error) {
    primaryError = error;
    actual = incompleteFeatureGolden(observedRuns, recovery, error);
  }
  const expected = await readFile(
    join(consumerRoot, 'tests', 'playwright-features', 'acceptance.golden'),
    'utf8',
  );
  await writeFeatureComparison(resultsRoot, expected, actual);
  if (primaryError !== undefined) throw primaryError;
  assert.equal(
    actual,
    expected,
    'Feature acceptance golden changed; inspect raw evidence and golden-diff.txt',
  );
  await writeFile(
    join(resultsRoot, 'receipt.json'),
    JSON.stringify({ ...proof, status: 'complete' }, null, 2),
  );
  await writeFile(
    join(resultsRoot, 'run-result.json'),
    JSON.stringify({ status: 'complete', runs: observedRuns }, null, 2),
  );
} catch (error) {
  await writeFile(
    join(resultsRoot, 'run-result.json'),
    JSON.stringify({ status: 'failed', error: featureError(error), runs: observedRuns }, null, 2),
  );
  throw error;
}
process.stdout.write(`Playwright setup and retention journeys passed: ${resultsRoot}\n`);
