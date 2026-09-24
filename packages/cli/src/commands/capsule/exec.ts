import { Command, Flags } from '@oclif/core';
import {
  execCapsule,
  type CapsuleClientOutcome,
  type CapsuleExecutionOutcome,
} from '@suites/blackbox-capsule-internal';
import { capsuleFailure } from '../../capsule/capsule-output.js';

function writeClientOutcome(outcome: CapsuleClientOutcome): void {
  switch (outcome.result.kind) {
    case 'json':
      process.stdout.write(`${JSON.stringify(outcome.result.value)}\n`);
      break;
    case 'text':
      process.stdout.write(outcome.result.value);
      break;
    case 'empty':
      break;
  }
  if (outcome.telemetry.kind === 'incomplete') {
    process.stderr.write(`[blackbox] telemetry incomplete: ${outcome.telemetry.error.message}\n`);
  }
}

function finishProcess(command: Command, outcome: CapsuleExecutionOutcome): void {
  if (outcome.kind === 'client-completed') {
    writeClientOutcome(outcome);
    return;
  }
  if (outcome.stdout) {
    process.stdout.write(outcome.stdout);
  }
  if (outcome.stderr) {
    process.stderr.write(outcome.stderr);
  }
  if (outcome.kind === 'signaled') {
    command.error(`command terminated by ${outcome.signal}`, { exit: 1 });
  }
  if (outcome.exitCode !== 0) {
    command.error(`command exited with ${String(outcome.exitCode)}`, {
      exit: outcome.exitCode,
    });
  }
}

export default class CapsuleExec extends Command {
  static override strict = false;
  static override description = 'Run a host command, or explicitly inside a participant container.';
  static override flags = {
    session: Flags.string({ required: true }),
    participant: Flags.string(),
    client: Flags.string(),
    json: Flags.boolean({ default: false }),
  };
  public async run(): Promise<void> {
    const separator = this.argv.indexOf('--');
    const argv = (separator < 0 ? [] : this.argv.slice(separator + 1)) as [string, ...string[]];
    const { flags } = await this.parse(CapsuleExec);
    if (flags.client !== undefined && flags.participant !== undefined) {
      this.error('--client and --participant cannot be used together', { exit: 2 });
    }
    if (flags.client === undefined && argv.length === 0) {
      this.error('capsule exec requires a command after --', { exit: 2 });
    }
    const target =
      flags.client !== undefined
        ? { kind: 'client' as const, clientId: flags.client, args: [...argv] }
        : flags.participant === undefined
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
      if (result.outcome.kind !== 'client-completed' && result.outcome.stderr) {
        process.stderr.write(result.outcome.stderr);
      }
      process.stdout.write(`${JSON.stringify(result.outcome)}\n`);
      if (result.outcome.kind === 'signaled') {
        this.error(`command terminated by ${result.outcome.signal}`, { exit: 1 });
      }
      if (result.outcome.kind === 'exited' && result.outcome.exitCode !== 0) {
        this.error(`command exited with ${String(result.outcome.exitCode)}`, {
          exit: result.outcome.exitCode,
        });
      }
      return;
    }
    finishProcess(this, result.outcome);
  }
}
