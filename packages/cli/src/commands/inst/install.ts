import { Command, Flags } from '@oclif/core';
import { nodeRuntimeProvider } from '@suites/blackbox-inst-runtime-node';
import {
  installInstrumentation,
  instrumentationDirectoryRelativePath,
} from '@suites/blackbox-instrumentation-internal';

export default class InstInstall extends Command {
  static override description = 'Install project-local OpenTelemetry runtime instrumentation.';
  static override flags = {
    runtime: Flags.string({
      description: 'Application runtime to instrument',
      options: ['node'],
      required: true,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(InstInstall);
    const result = await installInstrumentation({
      projectDirectory: process.cwd(),
      runtime: flags.runtime,
      providers: [nodeRuntimeProvider],
    });
    if (!result.ok) {
      this.error(result.message, { exit: 1 });
    }
    const state =
      result.fileAction === 'unchanged' && result.dependencyAction === 'unchanged'
        ? 'already current'
        : 'installed';
    this.log(
      `${result.runtimeDisplayName} instrumentation ${state}: ${instrumentationDirectoryRelativePath}`,
    );
    for (const instruction of result.activation) {
      this.log(instruction.description);
      this.log(`  ${instruction.command}`);
    }
  }
}
