import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const safeSegment = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Where a retained attempt lives: beside the project's Blackbox configuration. */
export function retainedAttemptDirectory(configFile: string, sandboxId: string): string {
  if (!safeSegment.test(sandboxId)) {
    throw new Error(`Cannot retain sandbox ${JSON.stringify(sandboxId)}: unsafe directory name`);
  }
  return join(dirname(configFile), '.blackbox', 'experiments', sandboxId);
}

/**
 * Copy one finished attempt out of Playwright's output directory, which the next
 * run clears. Runs after sandbox cleanup, so retained telemetry is final.
 */
export async function retainAttempt(input: {
  readonly directory: string;
  readonly recordDirectory: string;
  readonly document: string;
}): Promise<void> {
  try {
    await mkdir(input.directory, { recursive: true });
    if (await exists(input.recordDirectory)) {
      await cp(input.recordDirectory, join(input.directory, 'sandbox'), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    }
    await writeFile(join(input.directory, 'attempt.json'), input.document, { flag: 'wx' });
  } catch (cause) {
    throw new Error(`Blackbox could not retain the attempt in ${input.directory}`, { cause });
  }
}
