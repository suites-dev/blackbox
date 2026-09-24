import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PackagedCollectorRuntime {
  readonly kind: 'packaged-node-runtime';
  readonly directory: string;
  readonly entrypoint: string;
}

export function packagedCollectorRuntime(): PackagedCollectorRuntime {
  const packageDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
  return {
    kind: 'packaged-node-runtime',
    directory: join(packageDirectory, 'dist'),
    entrypoint: 'main.js',
  };
}
