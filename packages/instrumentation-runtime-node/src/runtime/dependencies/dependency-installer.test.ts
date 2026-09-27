import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';

import {
  firstDependencyInstallCompletion,
  npmCommand,
  type NodeDependencyInstallResult,
} from './dependency-installer.js';

describe('dependency process completion', () => {
  it('settles once when a spawn error is followed by close', () => {
    const resolve = vi.fn<(result: NodeDependencyInstallResult) => void>();
    const complete = firstDependencyInstallCompletion(resolve);
    complete({ kind: 'dependency-install-failure', exitCode: 1, stderr: 'spawn failed' });
    complete({ kind: 'dependency-install-failure', exitCode: 1, stderr: '' });

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith({
      kind: 'dependency-install-failure',
      exitCode: 1,
      stderr: 'spawn failed',
    });
  });
});

describe('npm command resolution', () => {
  it('runs npm directly on POSIX platforms', () => {
    expect(npmCommand(['install', '--ignore-scripts'], 'linux')).toEqual({
      command: 'npm',
      args: ['install', '--ignore-scripts'],
    });
  });

  it('runs the npm.cmd shim through a fixed cmd.exe on Windows, ignoring ComSpec', () => {
    vi.stubEnv('ComSpec', 'C:\\attacker\\evil.exe');
    try {
      expect(npmCommand(['install'], 'win32')).toEqual({
        command: 'cmd.exe',
        args: ['/d', '/s', '/c', 'npm', 'install'],
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('starts the host npm without a shell', () => {
    const npm = npmCommand(['--version']);
    const result = spawnSync(npm.command, npm.args, { encoding: 'utf8', shell: false });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/u);
  });
});
