#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  createWriteStream,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { fileURLToPath } from 'node:url';

export const RETENTION_DAYS = 14;
const DEFAULT_TEARDOWN_TIMEOUT_MS = 2_000;
const STREAM_FLUSH_TIMEOUT_MS = 1_000;

function currentTime() {
  return new Date().toISOString();
}

export function sanitizePart(value) {
  const sanitized = String(value ?? 'unknown')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return sanitized || 'unknown';
}

export function buildArtifactName({ runId, runAttempt, lane, project }) {
  return [
    'ci-evidence',
    runId || 'local',
    runAttempt || '1',
    lane || 'unknown-lane',
    project || 'unknown-project',
  ]
    .map(sanitizePart)
    .join('-');
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function commandText(command) {
  return command.map((part) => shellQuote(part)).join(' ');
}

function parseEventPayload(environment) {
  const payloadPath = environment.GITHUB_EVENT_PATH;
  if (!payloadPath || !existsSync(payloadPath)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(payloadPath, 'utf8'));
  } catch {
    return {};
  }
}

function githubContext(environment, rootDir) {
  const event = parseEventPayload(environment);
  const pullRequest = event.pull_request;
  const base = pullRequest && pullRequest.base ? pullRequest.base : {};
  const head = pullRequest && pullRequest.head ? pullRequest.head : {};

  return {
    repository: environment.GITHUB_REPOSITORY || null,
    workflow: environment.GITHUB_WORKFLOW || null,
    job: environment.GITHUB_JOB || null,
    runId: environment.GITHUB_RUN_ID || 'local',
    runAttempt: environment.GITHUB_RUN_ATTEMPT || '1',
    eventName: environment.GITHUB_EVENT_NAME || 'local',
    ref: environment.GITHUB_REF || null,
    base: {
      ref: environment.GITHUB_BASE_REF || base.ref || null,
      sha: base.sha || null,
    },
    head: {
      ref: environment.GITHUB_HEAD_REF || head.ref || null,
      sha: head.sha || null,
    },
    checkedOutSha: checkedOutRevision(rootDir),
  };
}

function checkedOutRevision(rootDir) {
  const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: rootDir,
    encoding: 'utf8',
    timeout: 5_000,
  });
  const revision = result.stdout?.trim();
  // Event SHA can be a synthetic PR merge or a different dispatch ref. It is
  // not a fallback for the checkout actually represented by this receipt.
  return !result.error && result.status === 0 && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(revision)
    ? revision
    : null;
}

function toolVersion(command, args) {
  try {
    const result = spawnSync(command, args, { encoding: 'utf8' });
    if (result.status !== 0) {
      return null;
    }
    const output = result.stdout.trim();
    return output || null;
  } catch {
    return null;
  }
}

export function readLockfileDigest(rootDir) {
  const lockfilePath = path.join(rootDir, 'pnpm-lock.yaml');
  try {
    const digest = createHash('sha256').update(readFileSync(lockfilePath)).digest('hex');
    return digest;
  } catch {
    return null;
  }
}

function splitValues(values) {
  return (Array.isArray(values) ? values : [values])
    .flatMap((value) => String(value).split(/[\r\n,]+/))
    .map((value) => value.trim())
    .filter(Boolean);
}

function idsFromText(value) {
  const ids = [];
  const patterns = [
    /\bBLACKBOX_(?:RUN|EXECUTION)_IDS?\s*[:=]\s*["']?([A-Za-z0-9][A-Za-z0-9._:-]*)/g,
    /\bblackbox[^\r\n]{0,40}\b(?:run|execution)[_-]?ids?\s*[:=]\s*["']?([A-Za-z0-9][A-Za-z0-9._:-]*)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      if (match[1]) {
        ids.push(match[1]);
      }
    }
  }
  return ids;
}

function secretValues(environment) {
  return Object.entries(environment)
    .filter(
      ([name, value]) =>
        /(?:TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_KEY|PRIVATE_KEY)/i.test(name) &&
        typeof value === 'string' &&
        value.length >= 4,
    )
    .map(([, value]) => value)
    .sort((left, right) => right.length - left.length);
}

export function redactSecrets(value, environment = process.env) {
  let redacted = String(value);
  for (const secret of secretValues(environment)) {
    redacted = redacted.replaceAll(secret, '***');
  }
  return redacted
    .replace(/\b(authorization\s*:\s*(?:bearer|basic)\s+)[^\s]+/gi, '$1***')
    .replace(/\b((?:token|secret|password|passwd|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, '$1***')
    .replace(/\b(https?:\/\/[^\s/:@]+:)[^\s/@]+@/gi, '$1***@');
}

function createSecretRedactor(environment) {
  let pending = '';
  return new Transform({
    transform(chunk, _encoding, callback) {
      pending += chunk.toString();
      const boundary = pending.lastIndexOf('\n');
      if (boundary < 0) {
        callback();
        return;
      }
      const completeLines = pending.slice(0, boundary + 1);
      pending = pending.slice(boundary + 1);
      callback(null, redactSecrets(completeLines, environment));
    },
    flush(callback) {
      callback(null, redactSecrets(pending, environment));
    },
  });
}

export function collectBlackboxRunIds(environment, runResult = {}, output = '') {
  const values = [
    environment.BLACKBOX_RUN_ID,
    environment.BLACKBOX_RUN_IDS,
    environment.BLACKBOX_EXECUTION_ID,
    environment.BLACKBOX_EXECUTION_IDS,
    ...(Array.isArray(runResult.blackbox_run_ids) ? runResult.blackbox_run_ids : []),
    ...idsFromText(output),
  ].filter((value) => value !== undefined && value !== null);

  return [...new Set(splitValues(values))];
}

function defaultExpectations(lane, project, evidenceDir) {
  const logPath = path.posix.join(evidenceDir.replaceAll(path.sep, '/'), 'logs/command.log');
  if (lane === 'test') {
    return [
      { kind: 'junit', path: `reports/junit/${project}.xml`, required: true },
      {
        kind: 'coverage-blob',
        path: `reports/coverage-blobs/${project}.json`,
        required: true,
      },
      { kind: 'coverage', path: `coverage/${project}`, required: true },
      { kind: 'log', path: logPath, required: true },
    ];
  }

  if (lane === 'lint') {
    return [
      { kind: 'junit', path: `reports/eslint/${project}.xml`, required: true },
      { kind: 'coverage', path: `coverage/${project}`, required: false },
      { kind: 'log', path: logPath, required: true },
    ];
  }

  return [{ kind: 'log', path: logPath, required: true }];
}

function parseExpectations(values, lane, project, evidenceDir) {
  const rawValues = splitValues(values);
  if (rawValues.length === 0) {
    return defaultExpectations(lane, project, evidenceDir);
  }

  return rawValues.map((rawValue) => {
    const separator = rawValue.indexOf('=');
    if (separator <= 0 || separator === rawValue.length - 1) {
      throw new Error(`Expected evidence in kind=path form, received ${JSON.stringify(rawValue)}`);
    }

    let kind = rawValue.slice(0, separator).trim().toLowerCase();
    const evidencePath = rawValue.slice(separator + 1).trim();
    let required = true;
    if (kind.endsWith('?')) {
      required = false;
      kind = kind.slice(0, -1);
    }
    if (kind.startsWith('optional-')) {
      required = false;
      kind = kind.slice('optional-'.length);
    }
    return { kind, path: evidencePath, required };
  });
}

function normalizedRelative(value) {
  return value.replaceAll(path.sep, '/').replace(/^\.\//, '');
}

function targetPath(kind, sourcePath, project) {
  const normalized = normalizedRelative(sourcePath);
  const basename = path.posix.basename(normalized);
  switch (kind) {
    case 'junit':
      return `junit/${basename}`;
    case 'junit-dir':
      return 'junit';
    case 'coverage-blob':
    case 'coverage-raw':
      return `coverage/blobs/${basename}`;
    case 'coverage':
      if (normalized === 'coverage' || normalized.startsWith('coverage/')) {
        return normalized;
      }
      return `coverage/${sanitizePart(project)}/${basename}`;
    case 'log':
    case 'logs':
      return `logs/${basename}`;
    default:
      return `outputs/${basename}`;
  }
}

async function pathExists(target) {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

function pathWithin(root, candidate, label, { allowRoot = false } = {}) {
  if (path.isAbsolute(candidate)) {
    throw new Error(`${label} must be a workspace-relative path contained by the workspace`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, candidate);
  const relative = path.relative(resolvedRoot, resolved);
  if ((!allowRoot && relative === '') || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} must be a workspace-relative path contained by the workspace`);
  }

  const realRoot = realpathSync.native(resolvedRoot);
  let existing = resolvedRoot;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    const current = path.join(existing, component);
    try {
      const info = lstatSync(current);
      if (info.isSymbolicLink()) {
        throw new Error(`${label} may not traverse symbolic links`);
      }
      existing = current;
    } catch (error) {
      if (error && error.code === 'ENOENT') break;
      throw error;
    }
  }
  const realExisting = realpathSync.native(existing);
  const realRelative = path.relative(realRoot, realExisting);
  if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
    throw new Error(`${label} must be contained by the workspace`);
  }
  return resolved;
}

async function usableEvidence(target) {
  try {
    const info = await fs.lstat(target);
    if (info.isSymbolicLink()) {
      throw new Error(`Evidence paths may not contain symbolic links: ${target}`);
    }
    if (info.isFile()) return info.size > 0;
    if (!info.isDirectory()) return false;
    const entries = await fs.readdir(target);
    if (entries.length === 0) return false;
    let usable = false;
    for (const entry of entries) {
      usable = (await usableEvidence(path.join(target, entry))) || usable;
    }
    return usable;
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
    return false;
  }
}

async function copyEvidence(source, target) {
  if (path.resolve(source) === path.resolve(target)) {
    return;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(source, target, { recursive: true, force: true, dereference: false });
}

function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function inspectInputArtifacts(inputRoot, evidenceDir, expectedProjects, lane) {
  if (!inputRoot || !(await pathExists(inputRoot))) {
    return { artifacts: [], missingProjects: expectedProjects };
  }

  const entries = await fs.readdir(inputRoot, { withFileTypes: true });
  const artifacts = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'merged-blobs') {
      continue;
    }

    const artifactName = entry.name;
    const artifactRoot = path.join(inputRoot, artifactName);
    const receiptPath = path.join(artifactRoot, 'receipt.json');
    const inventoryPath = path.join(artifactRoot, 'inventory.json');
    const receiptPresent = await usableEvidence(receiptPath);
    const inventoryPresent = await usableEvidence(inventoryPath);
    const receipt = receiptPresent ? readJsonIfPresent(receiptPath) : null;
    const inventory = inventoryPresent ? readJsonIfPresent(inventoryPath) : null;
    const project = receipt && typeof receipt.project === 'string' ? receipt.project : null;
    const outputRoot = path.join(evidenceDir, 'inputs', sanitizePart(artifactName));
    const copiedPaths = [];

    if (receiptPresent) {
      const target = path.join(outputRoot, 'receipt.json');
      await copyEvidence(receiptPath, target);
      copiedPaths.push(`inputs/${sanitizePart(artifactName)}/receipt.json`);
    }
    if (inventoryPresent) {
      const target = path.join(outputRoot, 'inventory.json');
      await copyEvidence(inventoryPath, target);
      copiedPaths.push(`inputs/${sanitizePart(artifactName)}/inventory.json`);
    }

    artifacts.push({
      artifact_name: artifactName,
      project,
      lane: receipt && typeof receipt.lane === 'string' ? receipt.lane : lane,
      receipt: Boolean(receipt),
      inventory: Boolean(inventory),
      copied_paths: copiedPaths,
    });
  }

  const missingProjects = expectedProjects.filter((expectedProject) => {
    return !artifacts.some((artifact) => {
      if (artifact.project === expectedProject) {
        return true;
      }
      return artifact.artifact_name.endsWith(`-${lane}-${expectedProject}`);
    });
  });

  return { artifacts, missingProjects };
}

function normalizedResult(value) {
  const result = String(value || '').toLowerCase();
  if (
    result === 'success' ||
    result === 'passed' ||
    result === 'pass' ||
    (result.includes('success') && !result.includes('failure'))
  ) {
    return 'passed';
  }
  if (
    result.includes('failure') ||
    result === 'failure' ||
    result === 'failed' ||
    result === 'cancelled' ||
    result === 'timed_out' ||
    result === 'error'
  ) {
    return 'failed';
  }
  if (result === 'skipped' || result === 'not-run' || result === 'not_run') {
    return 'not-run';
  }
  return result || 'not-run';
}

function normalizedOutcome(value) {
  const outcome = String(value || 'not-run').toLowerCase();
  if (outcome === 'passed') return 'success';
  if (outcome === 'failed' || outcome === 'error') return 'failure';
  if (['success', 'failure', 'cancelled', 'skipped', 'not-run'].includes(outcome)) {
    return outcome;
  }
  return outcome;
}

function parseCommandOption(value) {
  if (!value) {
    return { text: null, argv: null };
  }
  return { text: value, argv: null };
}

export async function collectEvidence(input, dependencies = {}) {
  const rootDir = path.resolve(input.rootDir || process.cwd());
  const lane = String(input.lane || 'unknown-lane');
  const project = String(input.project || 'unknown-project');
  const evidenceDir = String(
    input.evidenceDir || path.join('.ci-evidence', lane, sanitizePart(project)),
  );
  const evidenceRoot = pathWithin(rootDir, evidenceDir, 'evidence-dir');
  const environment = dependencies.environment || process.env;
  const clock = dependencies.now || currentTime;
  const collectionStartedAt = clock();
  await fs.mkdir(evidenceRoot, { recursive: true });

  const runResultPath = path.join(evidenceRoot, 'run-result.json');
  const runResult = readJsonIfPresent(runResultPath) || {};
  const expectations = parseExpectations(input.expected || [], lane, project, evidenceDir);
  const artifactEntries = [];

  for (const expectation of expectations) {
    if (path.isAbsolute(expectation.path)) {
      throw new Error('Evidence source paths must be workspace-relative');
    }
    const source = pathWithin(rootDir, expectation.path, 'Evidence source', { allowRoot: false });
    if (source === evidenceRoot || source.startsWith(`${evidenceRoot}${path.sep}`)) {
      const allowedLog = path.relative(evidenceRoot, source) === path.join('logs', 'command.log');
      if (!allowedLog) throw new Error('Evidence sources may not copy the evidence output tree');
    }
    const targetRelative = targetPath(expectation.kind, expectation.path, project);
    const target = path.join(evidenceRoot, targetRelative);
    const present = await usableEvidence(source);
    if (present) {
      await copyEvidence(source, target);
    }
    artifactEntries.push({
      kind: expectation.kind,
      source_path: normalizedRelative(path.relative(rootDir, source)),
      artifact_path: targetRelative,
      required: expectation.required,
      status: present ? 'present' : 'missing',
    });
  }

  const expectedProjects = splitValues(input.expectedProjects || []);
  const inputArtifacts = await inspectInputArtifacts(
    input.inputRoot ? pathWithin(rootDir, input.inputRoot, 'input-root') : null,
    evidenceRoot,
    expectedProjects,
    lane,
  );
  const collectionEndedAt = clock();
  const context = githubContext(environment, rootDir);
  const command = runResult.command
    ? { text: runResult.command, argv: runResult.command_argv || null }
    : parseCommandOption(input.command);
  const safeCommand = {
    text: command.text ? redactSecrets(command.text, environment) : null,
    argv: Array.isArray(command.argv)
      ? command.argv.map((argument) => redactSecrets(argument, environment))
      : null,
  };
  const runTestCaseIdentifiers = splitValues(runResult.test_case_identifiers || []);
  const inputTestCaseIdentifiers = splitValues(input.testCaseIdentifiers || []);
  const missingRequired = artifactEntries.filter(
    (entry) => entry.required && entry.status === 'missing',
  );
  const missingBlockingEvidence = [
    ...missingRequired.map((entry) => entry.artifact_path),
    ...inputArtifacts.missingProjects.map((missingProject) => `project:${missingProject}`),
  ];
  const missingEvidence = [
    ...artifactEntries
      .filter((entry) => entry.status === 'missing')
      .map((entry) => entry.artifact_path),
    ...inputArtifacts.missingProjects.map((missingProject) => `project:${missingProject}`),
  ];
  const artifactRoots = [
    ...new Set([
      ...artifactEntries
        .filter((entry) => entry.status === 'present')
        .map((entry) => entry.artifact_path),
      ...artifactEntries
        .filter((entry) => entry.status === 'present' && entry.kind === 'log')
        .map(() => 'logs/'),
      ...(inputArtifacts.artifacts.length > 0 ? ['inputs/'] : []),
      ...((await pathExists(runResultPath)) ? ['run-result.json'] : []),
      'logs/evidence-collector.log',
      'receipt.json',
      'inventory.json',
    ]),
  ];
  let commandOutput = '';
  try {
    commandOutput = readFileSync(path.join(evidenceRoot, 'logs', 'command.log'), 'utf8');
  } catch {
    commandOutput = '';
  }
  const blackboxRunIds = collectBlackboxRunIds(environment, runResult, commandOutput);
  const lockfileDigest = readLockfileDigest(rootDir);
  const result = normalizedResult(runResult.result || input.result);
  const receipt = {
    schema_version: 1,
    repository: context.repository,
    repo: context.repository,
    workflow: context.workflow,
    job: context.job,
    run_id: context.runId,
    run_attempt: context.runAttempt,
    event: context.eventName,
    base: context.base,
    head: context.head,
    base_ref: context.base.ref,
    base_sha: context.base.sha,
    head_ref: context.head.ref,
    head_sha: context.head.sha,
    checked_out_sha: context.checkedOutSha,
    ref: context.ref,
    node: process.version,
    pnpm: toolVersion('pnpm', ['--version']),
    tool_versions: {
      node: process.version,
      pnpm: toolVersion('pnpm', ['--version']),
    },
    lockfile: {
      path: 'pnpm-lock.yaml',
      sha256: lockfileDigest,
    },
    lockfile_digest: lockfileDigest,
    lane,
    project,
    working_directory:
      normalizedRelative(
        path.relative(
          rootDir,
          pathWithin(
            rootDir,
            runResult.working_directory || input.workingDirectory || '.',
            'working-directory',
            { allowRoot: true },
          ),
        ),
      ) || '.',
    test_case_identifiers:
      runTestCaseIdentifiers.length > 0 ? runTestCaseIdentifiers : inputTestCaseIdentifiers,
    command: safeCommand.text,
    command_argv: safeCommand.argv,
    started_at: runResult.started_at || collectionStartedAt,
    ended_at: runResult.ended_at || collectionEndedAt,
    result,
    exit_code: Number.isInteger(runResult.exit_code) ? runResult.exit_code : null,
    signal: runResult.signal || null,
    blackbox_run_ids: blackboxRunIds,
    outcomes: {
      setup: normalizedOutcome(input.setupResult),
      command: result === 'passed' ? 'success' : result === 'failed' ? 'failure' : result,
      upload: normalizedOutcome(input.uploadResult),
    },
    artifact_name: buildArtifactName({
      runId: context.runId,
      runAttempt: context.runAttempt,
      lane,
      project,
    }),
    artifact_root: normalizedRelative(evidenceDir),
    artifact_roots: artifactRoots,
    artifact_retention_days: RETENTION_DAYS,
    missing_evidence: missingEvidence,
    missing_required_evidence: missingRequired.map((entry) => entry.artifact_path),
    collection: {
      started_at: collectionStartedAt,
      ended_at: collectionEndedAt,
      status:
        missingRequired.length === 0 && inputArtifacts.missingProjects.length === 0
          ? 'complete'
          : 'partial',
    },
  };

  const inventory = {
    schema_version: 1,
    generated_at: collectionEndedAt,
    lane,
    project,
    expected: artifactEntries,
    missing: missingEvidence,
    input_artifacts: inputArtifacts.artifacts,
    missing_projects: inputArtifacts.missingProjects,
    receipt: 'receipt.json',
  };

  await fs.writeFile(
    path.join(evidenceRoot, 'receipt.json'),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(evidenceRoot, 'inventory.json'),
    `${JSON.stringify(inventory, null, 2)}\n`,
  );
  const collectorLog = path.join(evidenceRoot, 'logs', 'evidence-collector.log');
  await fs.mkdir(path.dirname(collectorLog), { recursive: true });
  await fs.writeFile(
    collectorLog,
    `${JSON.stringify({ generated_at: collectionEndedAt, missing: missingEvidence })}\n`,
  );

  if (missingRequired.length > 0 || inputArtifacts.missingProjects.length > 0) {
    const error = new Error(
      `Required CI evidence is incomplete: ${missingBlockingEvidence.join(', ')}`,
    );
    error.result = { receipt, inventory, evidenceRoot };
    throw error;
  }
  return { receipt, inventory, evidenceRoot };
}

export async function runCommand(input, dependencies = {}) {
  const rootDir = path.resolve(input.rootDir || process.cwd());
  const lane = String(input.lane || 'unknown-lane');
  const project = String(input.project || 'unknown-project');
  const evidenceDir = String(
    input.evidenceDir || path.join('.ci-evidence', lane, sanitizePart(project)),
  );
  const evidenceRoot = pathWithin(rootDir, evidenceDir, 'evidence-dir');
  const command = Array.isArray(input.command) ? input.command : [];
  if (command.length === 0) {
    throw new Error('ci-evidence run requires a command after --');
  }
  const clock = dependencies.now || currentTime;
  const environment = dependencies.environment || process.env;
  const startedAt = clock();
  const logPath = path.join(evidenceRoot, 'logs', 'command.log');
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const logStream = createWriteStream(logPath, { flags: 'w', mode: 0o600 });
  const workingDirectory = input.cwd
    ? pathWithin(rootDir, input.cwd, 'cwd', { allowRoot: true })
    : rootDir;
  const safeCommandText = redactSecrets(commandText(command), environment);
  const teardownTimeoutMs = positiveInteger(
    input.teardownTimeoutMs,
    DEFAULT_TEARDOWN_TIMEOUT_MS,
    'teardown timeout',
  );
  logStream.write(
    `[ci-evidence] started=${startedAt} cwd=${JSON.stringify(
      normalizedRelative(path.relative(rootDir, workingDirectory)) || '.',
    )} command=${JSON.stringify(safeCommandText)}\n`,
  );
  const child = spawn(command[0], command.slice(1), {
    cwd: workingDirectory,
    env: {
      ...environment,
      BLACKBOX_CI_LANE: lane,
      BLACKBOX_CI_PROJECT: project,
    },
    stdio: ['inherit', 'pipe', 'pipe'],
    // A separate process group lets cancellation reach descendants which inherited
    // our stdio. Without it, an orphaned grandchild can keep these pipes open forever.
    detached: process.platform !== 'win32',
  });
  const mirror = (stream, output) => {
    const redactor = createSecretRedactor(environment);
    const finished = new Promise((resolve) => {
      redactor.once('end', resolve);
      redactor.once('close', resolve);
      redactor.once('error', resolve);
    });
    redactor.on('data', (chunk) => {
      logStream.write(chunk);
      output.write(chunk);
    });
    stream.pipe(redactor);
    return {
      finished,
      stop() {
        stream.unpipe(redactor);
        stream.destroy();
        redactor.end();
      },
    };
  };
  const mirrors = [
    mirror(child.stdout, dependencies.stdout || process.stdout),
    mirror(child.stderr, dependencies.stderr || process.stderr),
  ];
  let cancellationSignal = null;
  const handlers = new Map();
  const removeCancellationHandlers = () => {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  };
  const cancellationReceived = new Promise((resolve) => {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const handler = () => {
        cancellationSignal ||= signal;
        resolve(signal);
      };
      handlers.set(signal, handler);
      process.on(signal, handler);
    }
  });
  const childExit = new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    child.once('error', (error) => finish({ code: null, signal: null, error }));
    // `close` waits for every inherited pipe holder. `exit` does not, so cleanup
    // remains bounded even when a grandchild deliberately retains stdout/stderr.
    child.once('exit', (code, signal) => finish({ code, signal, error: null }));
  });
  let exit;
  let cleanup;
  let streamsFlushed = false;
  try {
    const first = await Promise.race([
      childExit.then((value) => ({ exit: value })),
      cancellationReceived.then((signal) => ({ cancellation: signal })),
    ]);
    exit = first.exit;
    cleanup = await teardownOwnedProcessGroup(child.pid, teardownTimeoutMs);
    if (!exit) {
      exit = await valueWithin(childExit, teardownTimeoutMs);
      if (!exit) {
        exit = {
          code: null,
          signal: null,
          error: new Error('child exit was not observed before teardown deadline'),
        };
        cleanup = {
          ...cleanup,
          ok: false,
          limitation: cleanup.limitation || 'child exit was not observed before teardown deadline',
        };
      }
    }
    streamsFlushed = await settleWithin(
      Promise.all(mirrors.map(({ finished }) => finished)),
      STREAM_FLUSH_TIMEOUT_MS,
    );
    if (!streamsFlushed) {
      for (const mirrorState of mirrors) mirrorState.stop();
      await settleWithin(
        Promise.all(mirrors.map(({ finished }) => finished)),
        STREAM_FLUSH_TIMEOUT_MS,
      );
    }
    const endedAt = clock();
    const signalExitCode = cancellationSignal === 'SIGINT' ? 130 : 143;
    const hasOriginalExitCode = Number.isInteger(exit.code);
    const originalExitCode = hasOriginalExitCode ? exit.code : 1;
    // Preserve a command failure; cleanup can only turn an otherwise-successful run
    // into failure, never conceal the original nonzero status.
    const exitCode =
      hasOriginalExitCode && originalExitCode !== 0
        ? originalExitCode
        : cancellationSignal
          ? signalExitCode
          : exit.error || exit.signal
            ? 1
            : cleanup.ok && streamsFlushed
              ? 0
              : 1;
    logStream.write(
      `[ci-evidence] ended=${endedAt} exit_code=${String(exitCode)} signal=${JSON.stringify(
        cancellationSignal || exit.signal,
      )} cleanup=${JSON.stringify(cleanup)} streams_flushed=${String(streamsFlushed)}\n`,
    );
    const logFinished = once(logStream, 'finish');
    logStream.end();
    await logFinished;
    let commandOutput = '';
    try {
      commandOutput = readFileSync(logPath, 'utf8');
    } catch {
      commandOutput = '';
    }
    const runResult = {
      schema_version: 1,
      lane,
      project,
      working_directory: normalizedRelative(path.relative(rootDir, workingDirectory)) || '.',
      test_case_identifiers: splitValues(input.testCaseIdentifiers || []),
      command: safeCommandText,
      command_argv: command.map((argument) => redactSecrets(argument, environment)),
      started_at: startedAt,
      ended_at: endedAt,
      result: exitCode === 0 ? 'passed' : 'failed',
      exit_code: exitCode,
      signal: cancellationSignal || exit.signal,
      error: exit.error
        ? redactSecrets(String(exit.error.message || exit.error), environment)
        : null,
      cleanup,
      streams_flushed: streamsFlushed,
      blackbox_run_ids: collectBlackboxRunIds(environment, {}, commandOutput),
    };
    await fs.writeFile(
      path.join(evidenceRoot, 'run-result.json'),
      `${JSON.stringify(runResult, null, 2)}\n`,
    );
    return runResult;
  } finally {
    // Keep cancellation owned until teardown, log flushing, and the durable result
    // have completed so a late signal cannot terminate the wrapper without a receipt.
    removeCancellationHandlers();
  }
}

function positiveInteger(value, fallback, label) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function settleWithin(promise, timeoutMs) {
  return valueWithin(
    promise.then(
      () => true,
      () => true,
    ),
    timeoutMs,
  ).then((value) => value ?? false);
}

function valueWithin(promise, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
    );
  });
}

function signalOwnedProcessGroup(pid, signal) {
  if (!Number.isInteger(pid)) return { sent: false, error: 'child pid unavailable' };
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, signal);
    return { sent: true, error: null };
  } catch (error) {
    if (error && error.code === 'ESRCH') return { sent: false, error: null };
    return { sent: false, error: String(error && (error.message || error)) };
  }
}

function processGroupExists(pid) {
  if (!Number.isInteger(pid)) return false;
  if (process.platform === 'linux') {
    // kill(0) also reports zombie-only groups. Zombies cannot retain pipes or run
    // code, so treating those as live would falsely report teardown failure.
    try {
      for (const entry of readdirSync('/proc')) {
        if (!/^\d+$/.test(entry)) continue;
        try {
          const stat = readFileSync(`/proc/${entry}/stat`, 'utf8');
          const fields = stat.slice(stat.lastIndexOf(') ') + 2).split(' ');
          if (fields[0] !== 'Z' && Number(fields[2]) === pid) return true;
        } catch {
          // Processes can disappear between directory enumeration and reading.
        }
      }
      return false;
    } catch {
      // Fall through to the portable, less precise process-group probe.
    }
  }
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && error.code === 'EPERM');
  }
}

async function waitForProcessGroup(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processGroupExists(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return !processGroupExists(pid);
}

async function teardownOwnedProcessGroup(pid, timeoutMs) {
  if (process.platform === 'win32') {
    const limitation =
      'descendant cleanup is unsupported on Windows; only the parent process can be inspected';
    if (!processGroupExists(pid)) {
      return { ok: false, term_sent: false, kill_sent: false, limitation };
    }
    const term = signalOwnedProcessGroup(pid, 'SIGTERM');
    await waitForProcessGroup(pid, timeoutMs);
    return {
      ok: false,
      term_sent: term.sent,
      kill_sent: false,
      limitation: term.error || limitation,
    };
  }
  if (!processGroupExists(pid)) {
    return { ok: true, term_sent: false, kill_sent: false, limitation: null };
  }
  const term = signalOwnedProcessGroup(pid, 'SIGTERM');
  if (await waitForProcessGroup(pid, timeoutMs)) {
    return { ok: !term.error, term_sent: term.sent, kill_sent: false, limitation: term.error };
  }
  // SIGKILL is unavoidable for descendants which refuse TERM. Process groups are
  // best-effort OS primitives: they cannot cover re-parented/detached descendants.
  const kill = signalOwnedProcessGroup(pid, 'SIGKILL');
  const gone = await waitForProcessGroup(pid, timeoutMs);
  const limitation = kill.error || (!gone ? 'process group still exists after SIGKILL' : null);
  return {
    ok: gone && !term.error && !kill.error,
    term_sent: term.sent,
    kill_sent: kill.sent,
    limitation,
  };
}

function parseCli(argv) {
  const options = { expected: [], 'expected-projects': [] };
  let index = 0;
  while (index < argv.length) {
    const current = argv[index];
    if (current === '--') {
      return { options, command: argv.slice(index + 1) };
    }
    if (!current.startsWith('--')) {
      throw new Error(`Unexpected argument ${JSON.stringify(current)}`);
    }
    const key = current.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value === '--') {
      throw new Error(`Missing value for --${key}`);
    }
    if (key === 'expected' || key === 'expected-projects') {
      options[key].push(value);
    } else {
      options[key] = value;
    }
    index += 2;
  }
  return { options, command: [] };
}

async function main() {
  const [operation, ...rest] = process.argv.slice(2);
  if (operation !== 'run' && operation !== 'collect') {
    throw new Error('Usage: ci-evidence.mjs <run|collect> [options] [-- command]');
  }
  const parsed = parseCli(rest);
  if (operation === 'run') {
    const result = await runCommand({
      lane: parsed.options.lane,
      project: parsed.options.project,
      evidenceDir: parsed.options['evidence-dir'],
      cwd: parsed.options.cwd,
      testCaseIdentifiers: parsed.options['test-case-identifiers'],
      teardownTimeoutMs: parsed.options['teardown-timeout-ms'],
      command: parsed.command,
    });
    process.exitCode = result.exit_code;
    return;
  }

  const result = await collectEvidence({
    lane: parsed.options.lane,
    project: parsed.options.project,
    evidenceDir: parsed.options['evidence-dir'],
    expected: parsed.options.expected,
    expectedProjects: parsed.options['expected-projects'],
    inputRoot: parsed.options['input-root'],
    command: parsed.options.command,
    result: parsed.options.result,
    setupResult: parsed.options['setup-result'],
    uploadResult: parsed.options['upload-result'],
    workingDirectory: parsed.options['working-directory'],
    testCaseIdentifiers: parsed.options['test-case-identifiers'],
  });
  process.stdout.write(`${JSON.stringify(result.receipt)}\n`);
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
