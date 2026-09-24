import { describe, expect, it, vi } from 'vitest';

import {
  firstDependencyInstallCompletion,
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
