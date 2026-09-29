// Isolated journey projects. Each journey gets a fresh directory holding the
// e2e project's catalog, project-authored drivers and instrumentation, an empty
// .blackbox/state and no retained capsules, so every capsule it contains was
// created by that journey.
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

/**
 * The drivers package.json written by capsule-assets.sh for THIS asset run:
 * every @suites dependency must be a tarball inside the current asset root.
 */
async function packedDriverManifest({ e2eRoot, assetRoot }) {
  const text = await readFile(join(e2eRoot, '.blackbox', 'drivers', 'package.json'), 'utf8');
  const specs = Object.values(JSON.parse(text).dependencies ?? {});
  // capsule-assets.sh may write `${TMPDIR}/…` with a doubled slash; compare
  // normalized absolute paths, never raw strings.
  const inAssetRoot = (spec) =>
    typeof spec === 'string' &&
    spec.startsWith('file:') &&
    resolve(spec.slice('file:'.length)).startsWith(`${resolve(assetRoot)}${sep}`);
  if (specs.length === 0 || !specs.every(inAssetRoot)) {
    throw new Error('journeys: drivers package.json is not from the current capsule-assets.sh run');
  }
  return text;
}

export async function createJourneyProject({ e2eRoot, parent, name, blackbox, assetRoot }) {
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
    await packedDriverManifest({ e2eRoot, assetRoot }),
  );
  await mkdir(join(directory, '.blackbox', 'state'), { recursive: true });
  // Prerequisites are installed by the packed CLI itself from this run's packed
  // tarballs, exactly as capsule-assets.sh and capsule-test.sh do; nothing is
  // assumed to survive an earlier E2E step.
  await execute(blackbox, ['driver', 'install', '--runtime', 'node'], { cwd: directory });
  await execute(blackbox, ['inst', 'install', '--runtime', 'node'], { cwd: directory });
  return directory;
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
