import { createRequire } from 'node:module';
import { realpath, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import { driverSdkPackageName } from './types.js';

export async function resolveInstalledDriverSdk(directory: string): Promise<{
  readonly kind: 'driver-sdk-resolved';
  readonly installationPath: string;
  readonly entrypoint: string;
}> {
  const localPackage = join(directory, 'node_modules', ...driverSdkPackageName.split('/'));
  const installed = await stat(localPackage);
  if (!installed.isDirectory()) {
    throw new Error(`${driverSdkPackageName} is not a directory in ${directory}`);
  }
  const require = createRequire(join(directory, 'package.json'));
  const entrypoint = require.resolve(driverSdkPackageName);
  const packageRoot = await realpath(localPackage);
  const fromPackage = relative(packageRoot, entrypoint);
  if (fromPackage === '..' || fromPackage.startsWith(`..${sep}`)) {
    throw new Error(`${driverSdkPackageName} resolved outside its local installation`);
  }
  return {
    kind: 'driver-sdk-resolved',
    installationPath: localPackage,
    entrypoint,
  };
}
