import { Command, Flags } from '@oclif/core';
import { execCapsule } from '@suites/blackbox-capsule-internal';
import { capsuleFailure } from '../../capsule/capsule-output.js';

export default class CapsuleExec extends Command {
  static override strict = false;
  static override description = 'Run a host command, or explicitly inside a participant container.';
  static override flags = {
    session: Flags.string({ required: true }),
    participant: Flags.string(),
    json: Flags.boolean({ default: false }),
  };
  public async run(): Promise<void> {
    const separator = this.argv.indexOf('--');
    const argv = (separator < 0 ? [] : this.argv.slice(separator + 1)) as [string, ...string[]];
    if (argv.length === 0) {
      this.error('capsule exec requires a command after --', { exit: 2 });
    }
    const { flags } = await this.parse(CapsuleExec);
    const target =
      flags.participant === undefined
        ? { kind: 'host' as const, argv }
        : { kind: 'participant' as const, participant: flags.participant, argv };
    const result = await execCapsule({
      projectDirectory: process.cwd(),
      sessionId: flags.session,
      target,
    });
    if (result.kind !== 'capsule-exec-completed') {
      if (flags.json) {
        this.log(capsuleFailure({ result, json: true }));
      }
      this.error(capsuleFailure({ result, json: false }), { exit: 1 });
    }
    if (flags.json) {
      if (result.outcome.stderr) {
        process.stderr.write(result.outcome.stderr);
      }
      process.stdout.write(`${JSON.stringify(result.outcome)}\n`);
      if (result.outcome.kind === 'signaled') {
        this.error(`command terminated by ${result.outcome.signal}`, { exit: 1 });
      }
      if (result.outcome.exitCode !== 0) {
        this.error(`command exited with ${String(result.outcome.exitCode)}`, {
          exit: result.outcome.exitCode,
        });
      }
      return;
    }
    if (result.outcome.stdout) {
      process.stdout.write(result.outcome.stdout);
    }
    if (result.outcome.stderr) {
      process.stderr.write(result.outcome.stderr);
    }
    if (result.outcome.kind === 'signaled') {
      this.error(`command terminated by ${result.outcome.signal}`, { exit: 1 });
    }
    if (result.outcome.exitCode !== 0) {
      this.error(`command exited with ${String(result.outcome.exitCode)}`, {
        exit: result.outcome.exitCode,
      });
    }
  }
}
