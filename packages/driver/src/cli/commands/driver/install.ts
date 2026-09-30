import { Command, Flags } from '@oclif/core';

import { installDriverRuntime } from '../../driver/installation/install-driver-runtime.js';
import { installDriverDependencies } from '../../driver/installation/package-manager.js';

export default class DriverInstall extends Command {
  static override description = 'Install the project-owned Node driver runtime.';
  static override flags = {
    runtime: Flags.string({ required: true, options: ['node'] }),
    json: Flags.boolean({ default: false }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(DriverInstall);
    const result = await installDriverRuntime({
      projectDirectory: process.cwd(),
      packageManager: installDriverDependencies,
    });
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (!result.ok) {
        this.exit(1);
      }
      return;
    }
    if (!result.ok) {
      this.error(result.message, { exit: 1 });
    }
    this.log(
      `Node driver runtime installed: .blackbox/drivers (${result.files.package}, ${result.files.runtime})`,
    );
    this.log(`${result.dependency.packageName} resolved from ${result.dependency.entrypoint}`);
  }
}
