import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { retainAttempt, retainedAttemptDirectory } from './retention.js';

it('keeps retained attempts beside the Blackbox configuration', () => {
  expect(retainedAttemptDirectory('/project/blackbox.config.yaml', 'playwright-1')).toBe(
    '/project/.blackbox/experiments/playwright-1',
  );
});

it.each(['../escape', 'nested/id', '.hidden', ''])(
  'refuses a sandbox ID that is not a single safe directory name (%j)',
  (sandboxId) => {
    expect(() => retainedAttemptDirectory('/project/blackbox.config.yaml', sandboxId)).toThrow(
      'unsafe directory name',
    );
  },
);

it('never overwrites an attempt that is already retained', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-retention-'));
  try {
    const directory = join(root, 'retained');
    const recordDirectory = join(root, 'missing-record-directory');
    await retainAttempt({ directory, recordDirectory, document: '{"first":true}' });
    await expect(
      retainAttempt({ directory, recordDirectory, document: '{"second":true}' }),
    ).rejects.toThrow(`Blackbox could not retain the attempt in ${directory}`);
    await expect(readFile(join(directory, 'attempt.json'), 'utf8')).resolves.toBe('{"first":true}');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
