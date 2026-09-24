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
    if (typeof record.sessionId !== 'string' || !/^[a-z]+-[a-z]+-[a-z]+$/u.test(record.sessionId) || entry.name !== `capsule-${record.sessionId}`) {
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
  for (const name of ['reports', 'experiments', 'tmp', 'instrumentation']) {
    await rm(join(runtime, name), { recursive: true, force: true });
  }
  // Older versions left this empty directory after removing their IPC socket.
  // Never unlink an unknown live socket just to make a directory disappear.
  try { await rmdir(join(runtime, 's')); }
  catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error; }
}

async function main() {
  const projectDirectory = resolve(dirname(scriptPath), '..');
  const cli = resolve(projectDirectory, '../packages/cli/bin/run.js');
  await resetCapsuleDemo({ projectDirectory, stopSession: async ({ sessionId }) => {
    process.stdout.write(`[blackbox] Stopping previous demo Capsule ${sessionId}\n`);
    const args = ['capsule', 'stop', '--session', sessionId, '--json'];
    const result = process.env.BLACKBOX_BIN
      ? await execute(process.env.BLACKBOX_BIN, args, { cwd: projectDirectory })
      : await execute(process.execPath, [cli, ...args], { cwd: projectDirectory });
    const outcome = JSON.parse(result.stdout);
    if (outcome.kind !== 'capsule-stopped' || outcome.cleanup !== 'complete') throw new Error(`Cleanup was not confirmed for ${sessionId}`);
  } });
  process.stdout.write('[blackbox] Reset demo reports, experiments, temporary files, and instrumentation.\n');
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  await main();
}
