#!/usr/bin/env node
// Golden CLI journeys. Each *.golden file runs in its own isolated project
// through one persistent bash session; actual output is normalized and
// compared with the golden text. Artifacts (raw.txt, normalized.txt,
// diff.txt) are written per journey whether it passes or fails.
//
//   node e2e/journeys/run-journeys.mjs [--repeat N] [journey-name ...]
// --repeat runs every journey N times in a row, each in a fresh isolated
// project, with no golden update in between (determinism acceptance).
//   BLACKBOX_GOLDEN_UPDATE=1 rewrites golden files locally (refused when CI=true).
// Artifacts always go to <repo>/.blackbox/tmp/ci-e2e-journeys, reset per run.
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { BashSession } from './journey-session.mjs';
import {
  createNormalizer,
  normalizeWhitespace,
  parseGolden,
  renderTranscript,
} from './journey-format.mjs';
import { runItems } from './journey-steps.mjs';
import {
  cleanupJourneyProject,
  createJourneyProject,
  listCapsules,
  retainedActivityIds,
} from './journey-project.mjs';

const execute = promisify(execFile);
const JOURNEY_ROOT = dirname(fileURLToPath(import.meta.url));
const E2E_ROOT = dirname(JOURNEY_ROOT);
const WORKSPACE_ROOT = dirname(E2E_ROOT);
const ARTIFACT_ROOT = join(WORKSPACE_ROOT, '.blackbox', 'tmp', 'ci-e2e-journeys');
// A short root keeps <project>/.blackbox/tmp/bb-<hash>.sock under the Unix
// socket path limit (104 bytes on macOS, 108 on Linux). This works around a
// Capsule package bug (long project paths truncate the manager socket path);
// see the PR for the tracking issue.
const PROJECT_PARENT = '/tmp';
const STATE_FILE = join(E2E_ROOT, '.blackbox', 'capsule-assets.json');

const ASSET_ROOT_NAME = /^blackbox-capsule-assets\.[A-Za-z0-9]+$/u;

/**
 * The packed CLI of the current capsule-assets.sh run. As in
 * e2e/bash/capsule-asset-boundary.mjs, every path is rebuilt from the fixed
 * asset layout under the OS temp directory; the state file only names which
 * asset directory, and nothing it contains is executed or used as a path as-is.
 */
async function packedAssets() {
  let state;
  try {
    state = JSON.parse(await readFile(STATE_FILE, 'utf8'));
  } catch {
    throw new Error(
      'journeys: packed CLI assets are missing; run e2e/bash/capsule-assets.sh first',
    );
  }
  const name = typeof state?.assetRoot === 'string' ? basename(state.assetRoot) : '';
  if (!ASSET_ROOT_NAME.test(name)) {
    throw new Error(`journeys: invalid packed asset root in ${STATE_FILE}`);
  }
  const assetRoot = join(tmpdir(), name);
  const blackbox = join(assetRoot, 'consumer', 'node_modules', '.bin', 'blackbox');
  if (resolve(state.assetRoot) !== resolve(assetRoot) || resolve(state.blackboxBin) !== blackbox) {
    throw new Error('journeys: packed asset state does not match the fixed E2E asset layout');
  }
  await execute(blackbox, ['--help']);
  return { blackbox, assetRoot };
}

async function runJourney({
  name,
  pass,
  goldenPath,
  blackbox,
  assetRoot,
  artifactRoot,
  projectParent,
}) {
  const golden = await readFile(goldenPath, 'utf8');
  const items = parseGolden(golden);
  const directory = await createJourneyProject({
    e2eRoot: E2E_ROOT,
    parent: projectParent,
    name,
    blackbox,
    assetRoot,
  });
  const before = await listCapsules({ directory, blackbox });
  if (before.length !== 0) throw new Error(`${name}: isolated project is not empty`);
  const session = new BashSession({
    cwd: directory,
    env: journeyEnvironment(dirname(blackbox)),
  });
  const raw = [];
  const executed = [];
  let failure = null;
  let problems = [];
  try {
    await runItems({ items, session, raw, executed });
  } catch (error) {
    failure = error;
  } finally {
    await session.close();
    problems = await cleanupJourneyProject({ directory, blackbox });
  }
  const activityIds = await retainedActivityIds(directory);
  if (problems.length === 0) {
    // Nothing is left running; the transcript and artifacts carry the evidence.
    await rm(directory, { recursive: true, force: true });
  }
  const normalize = createNormalizer({
    projectPaths: [directory],
    activityIds,
  });
  const actual = normalizeWhitespace(
    renderTranscript(
      executed.map((item) =>
        item.kind === 'command' ? { ...item, output: normalize(item.output) } : item,
      ),
    ),
  );
  const expected = normalizeWhitespace(golden);
  const output = join(artifactRoot, 'journeys', pass === 1 ? name : `${name}.pass-${String(pass)}`);
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'raw.txt'), raw.join(''));
  await writeFile(join(output, 'normalized.txt'), actual);
  const diff =
    actual === expected ? '' : await unifiedDiff(goldenPath, join(output, 'normalized.txt'));
  await writeFile(join(output, 'diff.txt'), diff);
  return { name, goldenPath, actual, matched: actual === expected, failure, problems, output };
}

function journeyEnvironment(binDirectory) {
  const env = { ...process.env, PATH: `${binDirectory}:${process.env.PATH}`, NO_COLOR: '1' };
  delete env.BLACKBOX_CAPSULE;
  return env;
}

async function unifiedDiff(expectedPath, actualPath) {
  try {
    await execute('diff', ['-u', expectedPath, actualPath]);
    return '';
  } catch (error) {
    return error.stdout ?? String(error);
  }
}

async function main() {
  const update = process.env.BLACKBOX_GOLDEN_UPDATE === '1';
  const { blackbox, assetRoot } = await packedAssets();
  try {
    await runSelected({ update, blackbox, assetRoot });
  } finally {
    // capsule-assets.sh resets the e2e project's instrumentation; reinstall it
    // with the packed CLI exactly as capsule-test.sh does, so the checkout is
    // left as it was found.
    await execute(blackbox, ['inst', 'install', '--runtime', 'node'], { cwd: E2E_ROOT });
  }
}

async function runSelected({ update, blackbox, assetRoot }) {
  // Fixed locations only; nothing here comes from the environment. CI collects
  // ARTIFACT_ROOT as this run's evidence (see .github/workflows/e2e.yml).
  await rm(ARTIFACT_ROOT, { recursive: true, force: true });
  await mkdir(ARTIFACT_ROOT, { recursive: true });
  const artifactRoot = ARTIFACT_ROOT;
  const projectParent = PROJECT_PARENT;
  const argv = process.argv.slice(2);
  const repeatAt = argv.indexOf('--repeat');
  const repeat = repeatAt < 0 ? 1 : Number(argv[repeatAt + 1]);
  if (!Number.isInteger(repeat) || repeat < 1)
    throw new Error('journeys: --repeat needs a positive integer');
  if (update && repeat !== 1)
    throw new Error('journeys: BLACKBOX_GOLDEN_UPDATE cannot be combined with --repeat');
  const selected =
    repeatAt < 0 ? argv : argv.filter((_, index) => index !== repeatAt && index !== repeatAt + 1);
  const goldens = (await readdir(JOURNEY_ROOT))
    .filter((file) => file.endsWith('.golden'))
    .filter((file) => selected.length === 0 || selected.includes(file.replace(/\.golden$/u, '')))
    .sort();
  let failed = false;
  for (let pass = 1; pass <= repeat; pass += 1) {
    for (const file of goldens) {
      const name = file.replace(/\.golden$/u, '');
      const result = await runJourney({
        name,
        pass,
        goldenPath: join(JOURNEY_ROOT, file),
        blackbox,
        assetRoot,
        artifactRoot,
        projectParent,
      });
      if (update && result.failure === null && result.problems.length === 0) {
        await writeFile(result.goldenPath, result.actual);
      }
      const passed =
        (update || result.matched) && result.failure === null && result.problems.length === 0;
      failed ||= !passed;
      console.log(
        `journey ${name} (pass ${String(pass)}): ${passed ? 'passed' : 'FAILED'} (artifacts: ${result.output})`,
      );
      if (result.failure !== null) console.log(`  ${result.failure.message}`);
      for (const problem of result.problems) console.log(`  cleanup: ${problem}`);
      if (!result.matched && !update)
        console.log(await readFile(join(result.output, 'diff.txt'), 'utf8'));
    }
  }
  if (goldens.length === 0) throw new Error('journeys: no golden journeys were selected');
  process.exitCode = failed ? 1 : 0;
}

if (process.env.BLACKBOX_GOLDEN_UPDATE === '1' && process.env.CI === 'true') {
  console.error('journeys: BLACKBOX_GOLDEN_UPDATE is refused when CI=true');
  process.exit(2);
}
try {
  await main();
} finally {
  // The packed consumer belongs to this run, exactly as capsule-test.sh treats it.
  await execute(process.execPath, [join(E2E_ROOT, 'bash', 'capsule-asset-cleanup.mjs')]).catch(
    (error) => {
      console.error(`journeys: packed asset cleanup failed: ${error.message}`);
      process.exitCode = 1;
    },
  );
}
