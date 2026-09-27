import { spawn } from 'node:child_process';

export interface NodeDependencyInstallRequest {
  readonly directory: string;
}

export interface NodeDependencyInstallSuccess {
  readonly kind: 'dependency-install-success';
  readonly exitCode: 0;
  readonly stderr: string;
}

export interface NodeDependencyInstallFailure {
  readonly kind: 'dependency-install-failure';
  readonly exitCode: number;
  readonly stderr: string;
}

export type NodeDependencyInstallResult =
  | NodeDependencyInstallSuccess
  | NodeDependencyInstallFailure;
export type NodeDependencyInstaller = (
  input: NodeDependencyInstallRequest,
) => Promise<NodeDependencyInstallResult>;

export function firstDependencyInstallCompletion(
  resolve: (result: NodeDependencyInstallResult) => void,
): (result: NodeDependencyInstallResult) => void {
  let completed = false;
  return (result) => {
    if (completed) {
      return;
    }
    completed = true;
    resolve(result);
  };
}

/**
 * Resolves how to run npm without a shell. On Windows npm is a `npm.cmd` batch
 * shim, which Node refuses to spawn directly with `shell: false`, so it runs
 * through a fixed `cmd.exe /d /s /c` instead; the command never comes from the
 * environment (such as `ComSpec`). Callers must pass only fixed arguments:
 * cmd.exe interprets metacharacters in them.
 */
export function npmCommand(
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): { readonly command: string; readonly args: readonly string[] } {
  return platform === 'win32'
    ? { command: 'cmd.exe', args: ['/d', '/s', '/c', 'npm', ...args] }
    : { command: 'npm', args };
}

export const installNodeDependencies: NodeDependencyInstaller = async ({ directory }) =>
  await new Promise<NodeDependencyInstallResult>((resolve) => {
    const complete = firstDependencyInstallCompletion(resolve);
    const npm = npmCommand([
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-package-lock',
      '--save=false',
    ]);
    const child = spawn(
      npm.command,
      npm.args,
      {
        cwd: directory,
        env: process.env,
        shell: false,
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      complete({ kind: 'dependency-install-failure', exitCode: 1, stderr: error.message });
    });
    child.once('close', (code) => {
      if (code === 0) {
        complete({ kind: 'dependency-install-success', exitCode: 0, stderr });
        return;
      }
      complete({
        kind: 'dependency-install-failure',
        exitCode: code ?? 1,
        stderr,
      });
    });
  });
