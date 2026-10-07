import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Runs git in `cwd` and returns its stdout; a failing git command throws with git's message. */
export async function git(args: readonly string[], cwd: string): Promise<string> {
  const { stdout } = await run('git', [...args], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return stdout;
}

/** The repository's top-level directory, as git resolves it. */
export async function gitTopLevel(cwd: string): Promise<string> {
  return (await git(['rev-parse', '--show-toplevel'], cwd)).trim();
}
