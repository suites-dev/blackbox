import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Command, Flags } from '@oclif/core';

const packageDocument = {
  name: 'blackbox-project-clients',
  private: true,
  type: 'module',
} as const;

const runtimeDocument = {
  schemaVersion: 1,
  kind: 'blackbox-client-runtime',
  runtime: 'node',
} as const;

async function writeIfAbsent(path: string, value: unknown): Promise<'created' | 'retained'> {
  try {
    await readFile(path);
    return 'retained';
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
  }
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return 'created';
}

export default class ClientInstall extends Command {
  static override description = 'Prepare project-owned Capsule clients for one runtime.';
  static override flags = {
    runtime: Flags.string({ required: true, options: ['node'] }),
    json: Flags.boolean({ default: false }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(ClientInstall);
    const directory = join(process.cwd(), '.blackbox', 'clients');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const packageFile = await writeIfAbsent(join(directory, 'package.json'), packageDocument);
    const runtimeFile = await writeIfAbsent(
      join(directory, 'blackbox-client-runtime.json'),
      runtimeDocument,
    );
    const result = {
      kind: 'client-runtime-installation',
      runtime: flags.runtime,
      directory,
      files: { package: packageFile, runtime: runtimeFile },
      dependencyOwnership: 'user',
    } as const;
    this.log(
      flags.json
        ? JSON.stringify(result)
        : `Node client runtime ready: .blackbox/clients (${packageFile}, ${runtimeFile})`,
    );
  }
}
