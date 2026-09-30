// Isolated journey projects. Each journey gets a fresh directory holding the
// e2e project's catalog, project-authored drivers and instrumentation, an empty
// .blackbox/state and no retained capsules, so every capsule it contains was
// created by that journey.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
/** Journey helpers a golden may pipe into (lib/json-shape.mjs); a fixed directory. */
export const JOURNEY_LIB = join(dirname(fileURLToPath(import.meta.url)), 'lib');

/**
 * The drivers package.json written by the consumer preparation: every @suites
 * dependency must name the published version exactly, so the journey project
 * resolves the same tarballs the consumer installed and never a workspace path
 * or a floating range.
 */
async function publishedDriverManifest({ e2eRoot, version }) {
  const text = await readFile(join(e2eRoot, '.blackbox', 'drivers', 'package.json'), 'utf8');
  const specs = Object.values(JSON.parse(text).dependencies ?? {});
  if (specs.length === 0 || !specs.every((spec) => spec === version)) {
    throw new Error(`journeys: drivers package.json does not pin the published ${version}`);
  }
  return text;
}

export async function createJourneyProject({ e2eRoot, parent, name, blackbox, version }) {
  await mkdir(parent, { recursive: true });
  const directory = await realpath(await mkdtemp(join(parent, 'bbj-')));
  await copyFile(join(e2eRoot, 'blackbox.config.yaml'), join(directory, 'blackbox.config.yaml'));
  // Compose paths are relative to the catalog file (../../sut); point them at
  // the real SUT so build contexts and bind mounts resolve without symlinks.
  const catalog = join(directory, '.blackbox', 'catalog');
  await mkdir(catalog, { recursive: true });
  for (const file of await readdir(join(e2eRoot, '.blackbox', 'catalog'))) {
    const text = await readFile(join(e2eRoot, '.blackbox', 'catalog', file), 'utf8');
    await writeFile(join(catalog, file), text.replaceAll('../../sut', join(e2eRoot, 'sut')));
  }
  const drivers = join(directory, '.blackbox', 'drivers');
  await mkdir(drivers, { recursive: true });
  for (const file of await readdir(join(e2eRoot, '.blackbox', 'drivers'))) {
    if (file.endsWith('.mjs')) {
      await copyFile(join(e2eRoot, '.blackbox', 'drivers', file), join(drivers, file));
    }
  }
  await writeFile(
    join(drivers, 'package.json'),
    await publishedDriverManifest({ e2eRoot, version }),
  );
  await mkdir(join(directory, '.blackbox', 'state'), { recursive: true });
  // Prerequisites are installed by the published CLI itself, from the same
  // registry the consumer was installed from, exactly as the demo does; nothing
  // is assumed to survive an earlier E2E step.
  await execute(blackbox, ['driver', 'install', '--runtime', 'node'], { cwd: directory });
  await execute(blackbox, ['inst', 'install', '--runtime', 'node'], { cwd: directory });
  return directory;
}

/** A fresh random FIXTURE_CONTROL_TOKEN for one journey. */
export function newFixtureToken() {
  return randomBytes(24).toString('hex');
}

/**
 * The environment of one journey's bash session: the packed CLI first on
 * PATH, then the journey helpers, no ambient BLACKBOX_CAPSULE, and that
 * journey's own fixture token.
 * The runner's own process.env is never modified.
 */
export function journeyEnvironment({ binDirectory, fixtureToken, base = process.env }) {
  const env = {
    ...base,
    PATH: `${binDirectory}:${JOURNEY_LIB}:${base.PATH}`,
    NO_COLOR: '1',
    FIXTURE_CONTROL_TOKEN: fixtureToken,
  };
  delete env.BLACKBOX_CAPSULE;
  return env;
}

export async function listCapsules({ directory, blackbox }) {
  const { stdout } = await execute(blackbox, ['capsule', 'ls', '--all', '--json'], { cwd: directory });
  const document = JSON.parse(stdout);
  if (document.kind !== 'capsule-list') {
    throw new Error(`Unexpected ls document: ${stdout}`);
  }
  return document.capsules;
}

export async function retainedActivityIds(directory) {
  const root = join(directory, '.blackbox', 'experiments');
  const ids = [];
  for (const entry of await readdir(root).catch(() => [])) {
    const activities = await readFile(join(root, entry, 'activities.json'), 'utf8').catch(
      () => '[]',
    );
    ids.push(...JSON.parse(activities).map((activity) => activity.activityId));
  }
  return ids;
}

/** Every trace ID retained by the project's capsules, read with the packed CLI. */
export async function retainedTraceIds({ directory, blackbox }) {
  const ids = [];
  for (const capsule of await listCapsules({ directory, blackbox }).catch(() => [])) {
    try {
      const { stdout } = await execute(blackbox, ['capsule', 'show', capsule.capsule, '--json'], {
        cwd: directory,
      });
      const document = JSON.parse(stdout);
      if (Array.isArray(document.traceIds)) ids.push(...document.traceIds);
    } catch {
      // An unreadable capsule contributes no trace IDs; its output stays literal.
    }
  }
  return ids;
}

async function composeProjects(directory) {
  const root = join(directory, '.blackbox', 'experiments');
  const projects = [];
  for (const entry of await readdir(root).catch(() => [])) {
    const record = JSON.parse(await readFile(join(root, entry, 'session.json'), 'utf8'));
    if (record.composeProject.kind === 'available') projects.push(record.composeProject.value);
  }
  return projects;
}

async function labelled(kind, project) {
  const args =
    kind === 'container'
      ? ['ps', '-a', '-q', '--filter', `label=com.docker.compose.project=${project}`]
      : [kind, 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`];
  const { stdout } = await execute('docker', args);
  return stdout.split('\n').filter((line) => line.length > 0);
}

/**
 * Stops every capsule of this isolated project that is not stopped (including
 * one whose `up` exited nonzero), then fails on any container, network or
 * volume left behind under those capsules' Compose project labels.
 */
export async function cleanupJourneyProject({ directory, blackbox }) {
  const problems = [];
  for (const capsule of await listCapsules({ directory, blackbox })) {
    if (capsule.state === 'stopped') continue;
    try {
      await execute(blackbox, ['capsule', 'down', capsule.capsule, '--json'], { cwd: directory });
    } catch (error) {
      problems.push(`down ${capsule.capsule} failed: ${error.stdout ?? error.message}`);
    }
  }
  for (const project of await composeProjects(directory)) {
    for (const kind of ['container', 'network', 'volume']) {
      const leftovers = await labelled(kind, project);
      if (leftovers.length > 0) {
        problems.push(`${kind}s left for ${project}: ${leftovers.join(', ')}`);
      }
    }
  }
  return problems;
}
