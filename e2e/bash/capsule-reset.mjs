import { execFile } from 'node:child_process';
import { lstat, readdir, readFile, rm, rmdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);

async function directoryExists(path) {
  try {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Expected a real directory: ${path}`);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function stopPreviousSessions(input) {
  const experiments = join(input.projectDirectory, '.blackbox', 'experiments');
  if (!await directoryExists(experiments)) return;
  for (const entry of await readdir(experiments, { withFileTypes: true })) {
    if (!entry.name.startsWith('capsule-')) continue;
    const directory = join(experiments, entry.name);
    await directoryExists(directory);
    const record = JSON.parse(await readFile(join(directory, 'session.json'), 'utf8'));
    const validSessionId =
      typeof record.sessionId === 'string' &&
      /^[a-z]+-[a-z]+-[a-z]+(?:-[0-9]{12})?$/u.test(record.sessionId);
    if (!validSessionId || entry.name !== `capsule-${record.sessionId}`) {
      throw new Error(`Cannot reset an experiment with invalid identity: ${directory}`);
    }
    if (record.state === 'running' || record.state === 'stop-failed') {
      await input.stopSession({ sessionId: record.sessionId });
    } else if (record.cleanup.kind !== 'complete') {
      throw new Error(`Capsule ${record.sessionId} has unconfirmed cleanup (${record.state}); retained files were preserved.`);
    }
  }
}

/** Reset only demo outputs, after releasing any previously owned live Capsules. */
export async function resetCapsuleDemo(input) {
  const runtime = join(input.projectDirectory, '.blackbox');
  if (!await directoryExists(runtime)) return;
  await stopPreviousSessions(input);
  const drivers = join(runtime, 'drivers');
  const driversExist = await directoryExists(drivers);
  for (const name of ['reports', 'experiments', 'tmp', 'instrumentation', 'clients']) {
    await rm(join(runtime, name), { recursive: true, force: true });
  }
  if (driversExist) {
    for (const name of [
      'package.json',
      'blackbox-driver-runtime.json',
      'node_modules',
      'package-lock.json',
      'pnpm-lock.yaml',
      'yarn.lock',
    ]) {
      await rm(join(drivers, name), { recursive: true, force: true });
    }
  }
  // Older versions left this empty directory after removing their IPC socket.
  // Never unlink an unknown live socket just to make a directory disappear.
  try { await rmdir(join(runtime, 's')); }
  catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error; }
}

async function main() {
  const projectDirectory = resolve(dirname(scriptPath), '..');
  const cliEntrypoint = process.env.BLACKBOX_ENTRYPOINT;
  if (cliEntrypoint === undefined || !cliEntrypoint.startsWith('/')) {
    throw new Error(
      'capsule-reset requires an absolute BLACKBOX_ENTRYPOINT from capsule-assets.sh',
    );
  }
  await resetCapsuleDemo({ projectDirectory, stopSession: async ({ sessionId }) => {
    process.stdout.write(`[blackbox] Stopping previous demo Capsule ${sessionId}\n`);
    const args = ['capsule', 'stop', '--session', sessionId, '--json'];
    const result = await execute(process.execPath, [cliEntrypoint, ...args], {
      cwd: projectDirectory,
    });
    const outcome = JSON.parse(result.stdout);
    if (outcome.kind !== 'capsule-stopped' || outcome.cleanup !== 'complete') throw new Error(`Cleanup was not confirmed for ${sessionId}`);
  } });
  process.stdout.write(
    '[blackbox] Reset demo reports, experiments, temporary files, instrumentation, and generated driver state.\n',
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  await main();
}
