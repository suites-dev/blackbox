import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { CollectorStorageLease } from '../storage/lease.js';
import { fragmentDirectory } from '../storage/paths.js';

export interface CollectorRetentionLimits {
  readonly maxRetainedBytes: number;
  readonly maxRetainedFragments: number;
}

export interface CollectorRetentionUsage {
  readonly retainedBytes: number;
  readonly retainedFragments: number;
}

export class CollectorRetentionLimitError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'CollectorRetentionLimitError';
  }
}

export async function retainedUsage(
  lease: CollectorStorageLease,
): Promise<CollectorRetentionUsage> {
  const directory = fragmentDirectory(lease);
  const names = (await readdir(directory)).filter((name) => /^\d{12}\.json$/u.test(name));
  const sizes = await Promise.all(names.map(async (name) => (await stat(join(directory, name))).size));
  return {
    retainedBytes: sizes.reduce((total, size) => total + size, 0),
    retainedFragments: names.length,
  };
}
