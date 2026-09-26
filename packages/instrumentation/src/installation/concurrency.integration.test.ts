import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

import { installInstrumentation } from './install.js';
import type { RuntimeInstrumentationProvider } from './model.js';

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
}

function deferred<Value>(): Deferred<Value> {
  let complete = (_value: Value): void => {
    throw new Error('Deferred resolver was used before initialization.');
  };
  const promise = new Promise<Value>((resolve) => {
    complete = resolve;
  });
  return { promise, resolve: complete };
}

it('admits one provider preparation while a contender cannot delete its lock', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'blackbox-install-race-'));
  const entered = deferred<undefined>();
  const release = deferred<undefined>();
  const prepare = vi.fn(async () => {
    entered.resolve(undefined);
    await release.promise;
    return { kind: 'runtime-preparation-success', action: 'installed' } as const;
  });
  const provider = {
    kind: 'runtime-instrumentation-provider',
    runtime: 'test-runtime',
    displayName: 'Test Runtime',
    files: [
      { kind: 'runtime-instrumentation-file', name: 'instrumentation.js', content: 'ready\n' },
    ],
    activation: [],
    prepare,
  } satisfies RuntimeInstrumentationProvider;
  const input = { projectDirectory, runtime: 'test-runtime', providers: [provider] };
  const first = installInstrumentation(input);
  const target = join(projectDirectory, '.blackbox/instrumentation');
  try {
    await entered.promise;
    expect(await installInstrumentation(input)).toMatchObject({
      kind: 'instrumentation-install-busy',
    });
    expect((await stat(join(target, '.install.lock'))).isDirectory()).toBe(true);
    release.resolve(undefined);
    expect(await first).toMatchObject({ ok: true, fileAction: 'created' });
    expect(prepare).toHaveBeenCalledOnce();
  } finally {
    release.resolve(undefined);
    await first;
    await rm(projectDirectory, { recursive: true, force: true });
  }
});

it('releases ownership after provider rejection', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'blackbox-install-failure-'));
  const provider = {
    kind: 'runtime-instrumentation-provider',
    runtime: 'test-runtime',
    displayName: 'Test Runtime',
    files: [],
    activation: [],
    prepare: () => Promise.reject(new Error('provider unavailable')),
  } satisfies RuntimeInstrumentationProvider;
  try {
    expect(
      await installInstrumentation({
        projectDirectory,
        runtime: 'test-runtime',
        providers: [provider],
      }),
    ).toMatchObject({
      kind: 'instrumentation-install-operational-error',
      message: expect.stringContaining('provider unavailable'),
    });
    await expect(
      stat(join(projectDirectory, '.blackbox/instrumentation/.install.lock')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(projectDirectory, { recursive: true, force: true });
  }
});
