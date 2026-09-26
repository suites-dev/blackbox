import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { installInstrumentation, instrumentationDirectoryRelativePath } from './install.js';
import type { RuntimeInstrumentationProvider } from './model.js';

const fixtures: string[] = [];
const files = [
  { kind: 'runtime-instrumentation-file', name: 'package.json', content: '{"private":true}\n' },
  { kind: 'runtime-instrumentation-file', name: 'instrumentation.js', content: 'bootstrap();\n' },
] as const;

async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-instrumentation-'));
  fixtures.push(directory);
  return directory;
}

function provider(
  prepare: RuntimeInstrumentationProvider['prepare'],
): RuntimeInstrumentationProvider {
  return {
    kind: 'runtime-instrumentation-provider',
    runtime: 'test-runtime',
    displayName: 'Test Runtime',
    files,
    activation: [
      {
        kind: 'runtime-activation-instruction',
        description: 'Load the test runtime:',
        command: 'test-runtime --load instrumentation.js',
      },
    ],
    prepare,
  };
}

afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe('installInstrumentation', () => {
  it('installs provider files and preserves their content and mtimes on repeat', async () => {
    const projectDirectory = await fixture();
    const prepare = vi
      .fn<RuntimeInstrumentationProvider['prepare']>()
      .mockResolvedValueOnce({ kind: 'runtime-preparation-success', action: 'installed' })
      .mockResolvedValue({ kind: 'runtime-preparation-success', action: 'unchanged' });
    const input = { projectDirectory, runtime: 'test-runtime', providers: [provider(prepare)] };

    expect(await installInstrumentation(input)).toMatchObject({
      ok: true,
      fileAction: 'created',
      dependencyAction: 'installed',
      runtimeDisplayName: 'Test Runtime',
    });
    const target = join(projectDirectory, instrumentationDirectoryRelativePath);
    expect((await stat(target)).mode & 0o777).toBe(0o755);
    expect((await stat(join(projectDirectory, '.blackbox'))).mode & 0o777).toBe(0o700);
    const before = await Promise.all(
      files.map(async (file) => await stat(join(target, file.name))),
    );
    expect(await installInstrumentation(input)).toMatchObject({
      ok: true,
      fileAction: 'unchanged',
      dependencyAction: 'unchanged',
    });
    const after = await Promise.all(files.map(async (file) => await stat(join(target, file.name))));
    expect(after.map((entry) => entry.mtimeMs)).toEqual(before.map((entry) => entry.mtimeMs));
  });

  it('completes matching partial state and preserves unrelated files', async () => {
    const projectDirectory = await fixture();
    const target = join(projectDirectory, instrumentationDirectoryRelativePath);
    await mkdir(target, { recursive: true });
    await writeFile(join(target, files[0].name), files[0].content);
    await writeFile(join(target, 'notes.txt'), 'owned by user\n');
    const before = await stat(join(target, files[0].name));
    const prepare = vi.fn<RuntimeInstrumentationProvider['prepare']>().mockResolvedValue({
      kind: 'runtime-preparation-success',
      action: 'unchanged',
    });

    const result = await installInstrumentation({
      projectDirectory,
      runtime: 'test-runtime',
      providers: [provider(prepare)],
    });

    expect(result).toMatchObject({ ok: true, fileAction: 'created' });
    expect(await readFile(join(target, 'notes.txt'), 'utf8')).toBe('owned by user\n');
    expect((await stat(join(target, files[0].name))).mtimeMs).toBe(before.mtimeMs);
  });
});

describe('installation failures', () => {
  it('rejects conflicting files without preparing the runtime', async () => {
    const projectDirectory = await fixture();
    const target = join(projectDirectory, instrumentationDirectoryRelativePath);
    await mkdir(target, { recursive: true });
    await writeFile(join(target, files[1].name), '// user owned\n');
    const prepare = vi.fn<RuntimeInstrumentationProvider['prepare']>();

    const result = await installInstrumentation({
      projectDirectory,
      runtime: 'test-runtime',
      providers: [provider(prepare)],
    });

    expect(result).toMatchObject({ kind: 'instrumentation-install-conflict', ok: false });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('returns unsupported and provider preparation failures honestly', async () => {
    const projectDirectory = await fixture();
    const failedProvider = provider(() =>
      Promise.resolve({ kind: 'runtime-preparation-failure', message: 'runtime unavailable' }),
    );
    const unsupported = await installInstrumentation({
      projectDirectory,
      runtime: 'future-runtime',
      providers: [failedProvider],
    });
    const failed = await installInstrumentation({
      projectDirectory,
      runtime: 'test-runtime',
      providers: [failedProvider],
    });

    expect(unsupported).toMatchObject({ kind: 'unsupported-instrumentation-runtime', ok: false });
    expect(failed).toMatchObject({
      kind: 'instrumentation-install-operational-error',
      ok: false,
      message: 'runtime unavailable',
    });
  });
});
