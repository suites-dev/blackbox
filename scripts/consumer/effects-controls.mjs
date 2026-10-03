import assert from 'node:assert/strict';
import { cp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { install, pack } from './effects-artifacts.mjs';

export async function exerciseControls(input) {
  const results = [];
  for (const name of ['missing-runtime-entrypoint', 'always-pass-evaluator']) {
    const directory = join(input.temporary, `package-${name}`);
    await cp(input.installed, directory, { recursive: true });
    const entrypoint = join(directory, 'dist', 'index.js');
    const original = await readFile(entrypoint, 'utf8');
    if (name === 'missing-runtime-entrypoint') {
      await rm(entrypoint);
    } else {
      await rename(entrypoint, join(directory, 'dist', 'candidate-index.js'));
      await writeFile(
        entrypoint,
        [
          "export * from './candidate-index.js';",
          "import { evaluateEffects as candidate } from './candidate-index.js';",
          'export function evaluateEffects(graph, contract) {',
          "  return Object.freeze({ ...candidate(graph, contract), status: 'pass' });",
          '}',
          '',
        ].join('\n'),
      );
    }
    const packed = await pack({ ...input, name, directory });
    const consumer = await install({ ...input, ...packed, name });
    const test = await input.command(
      `${name}-test`,
      process.execPath,
      ['--test', '--test-reporter=tap', 'consumer.test.mjs'],
      consumer.directory,
      true,
    );
    assert.notEqual(test.status, 0, `${name} must be rejected`);
    assert.equal(test.signal, null, 'A timeout or signal is not semantic rejection');
    if (name === 'missing-runtime-entrypoint') {
      assert.match(test.output, /ERR_MODULE_NOT_FOUND/);
    } else {
      assert.match(test.output, /not ok \d+ - observed forbidden effect fails/);
      assert.match(test.output, /not ok \d+ - absence without observation remains inconclusive/);
      assert.match(test.output, /# tests 8\b/);
      assert.match(test.output, /# fail 4\b/);
      assert.match(test.output, /# skipped 0\b/);
    }
    results.push({
      name,
      exit: test.status,
      qualification:
        name === 'missing-runtime-entrypoint'
          ? 'artifact-boundary rejection; not semantic test qualification'
          : 'four semantic assertions reject a loadable evaluator that always passes',
      originalEntrypoint: original,
    });
  }
  return results;
}
