import { rm } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

/** Config metadata key under which defineGherkinConfig lists the manifests the Blackbox reporter writes. */
export const MANIFESTS_METADATA_KEY = 'blackboxGherkinManifests';

const isAbsolutePath = (file: unknown): file is string => typeof file === 'string' && isAbsolute(file);

/**
 * Playwright global setup added by defineGherkinConfig. It deletes the run
 * manifest and the runner-policy output before any test runs, so a run whose
 * Blackbox reporter was replaced on the command line leaves no manifest and
 * `verify` fails as missing instead of judging an earlier run. No Playwright
 * CLI flag removes a global setup.
 */
export default async function clearManifests(config: {
  readonly metadata: Readonly<Record<string, unknown>>;
}): Promise<void> {
  const files: unknown = config.metadata[MANIFESTS_METADATA_KEY];
  if (!Array.isArray(files) || !files.every(isAbsolutePath)) {
    throw new Error(
      `Playwright config metadata ${MANIFESTS_METADATA_KEY} must list absolute paths; build the config with defineGherkinConfig`,
    );
  }
  await Promise.all(files.map((file) => rm(file, { force: true })));
}
