import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { recoverSandbox } from '@suites/blackbox-sandbox';

export async function recoverResults(directory) {
  let files;
  try {
    files = await readdir(directory, { recursive: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const path = join(directory, file);
    let record;
    try {
      record = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw error;
    }
    if (
      record.schemaVersion !== 1 ||
      typeof record.sandboxId !== 'string' ||
      typeof record.projectName !== 'string' ||
      !Array.isArray(record.composeFiles)
    )
      continue;
    const result = await recoverSandbox({
      recordDirectory: dirname(path),
      sandboxId: record.sandboxId,
      timeoutMs: 60_000,
    });
    if (
      result.kind !== 'sandbox-recovered' &&
      !(result.kind === 'sandbox-recovery-not-required' && result.reason === 'already-clean')
    ) {
      throw new Error(`Effects test cleanup did not complete: ${JSON.stringify(result)}`);
    }
  }
}
