import { Command, Flags } from '@oclif/core';
import {
  execCapsule,
  type CapsuleExecutionOutcome,
  type CapsuleProcessOutcome,
} from '@suites/blackbox-capsule-internal';

import { capsuleFailure } from '../../capsule/capsule-output.js';
import { runProcessInteractiveCapsuleExec } from '../../capsule/execution/interactive-execution.js';

function processOutcome(outcome: CapsuleExecutionOutcome): CapsuleProcessOutcome | null {
  return outcome.kind === 'driver-completed'
    ? outcome.process
    : outcome.kind === 'exited' ||
          outcome.kind === 'signaled' ||
          outcome.kind === 'executable-not-found'
    ? outcome
    : null;
}

function writeProcessOutput(outcome: CapsuleProcessOutcome): void {
  if (outcome.kind === 'executable-not-found') {
    return;
  }
  if (outcome.stdout.length > 0) {
    process.stdout.write(outcome.stdout);
  }
  if (outcome.stderr.length > 0) {
    process.stderr.write(outcome.stderr);
  }
}

function finishProcess(
  command: Command,
  outcome: CapsuleExecutionOutcome,
  output: { readonly kind: 'captured' } | { readonly kind: 'streamed' },
): void {
  const processResult = processOutcome(outcome);
  if (processResult === null) {
    if (outcome.kind === 'driver-prepare-failed') {
      command.error(
        `Driver ${JSON.stringify(outcome.driverId)} could not prepare the command: ${outcome.error.message}`,
        { exit: 1 },
      );
    }
    if (outcome.kind === 'driver-propagation-refused') {
      command.error(
        `Driver ${JSON.stringify(outcome.driverId)} did not satisfy ${outcome.propagation.expectation.kind}. Use --allow-untraced to run while retaining this limitation.`,
        { exit: 1 },
      );
    }
    throw new Error(`Unhandled Capsule execution outcome: ${JSON.stringify(outcome)}`);
  }
  if (output.kind === 'captured') {
    writeProcessOutput(processResult);
  }
  if (processResult.kind === 'executable-not-found') {
    command.error(processResult.remediation, { exit: 127 });
  }
  if (processResult.kind === 'signaled') {
    command.error(`command terminated by ${processResult.signal}`, { exit: 1 });
  }
  if (processResult.exitCode !== 0) {
    command.error(`command exited with ${String(processResult.exitCode)}`, {
      exit: processResult.exitCode,
    });
  }
}

export default class CapsuleExec extends Command {
  static override strict = false;
  static override description = 'Run a host command or use a catalog driver.';
  static override flags = {
    session: Flags.string({ required: true }),
    driver: Flags.string(),
    purpose: Flags.string({
      default: 'stimulus',
      options: ['setup', 'stimulus', 'inspection'],
    }),
    'allow-untraced': Flags.boolean({ default: false }),
    json: Flags.boolean({ default: false }),
  };

  public async run(): Promise<void> {
    const separator = this.argv.indexOf('--');
    const argv = (separator < 0 ? [] : this.argv.slice(separator + 1)) as [string, ...string[]];
    const { flags } = await this.parse(CapsuleExec);
    if (argv.length === 0) {
      this.error('capsule exec requires a command after --', { exit: 2 });
    }
    if (flags.driver === undefined && flags['allow-untraced']) {
      this.error('--allow-untraced requires --driver', { exit: 2 });
    }
    const target =
      flags.driver === undefined
        ? { kind: 'host' as const, argv }
        : {
            kind: 'driver' as const,
            driverId: flags.driver,
            argv,
            untraced: flags['allow-untraced']
              ? ({ kind: 'allow' } as const)
              : ({ kind: 'refuse' } as const),
          };
    const execInput = {
      projectDirectory: process.cwd(),
      sessionId: flags.session,
      purpose: flags.purpose as 'setup' | 'stimulus' | 'inspection',
      target,
    };
    const interactive = !flags.json && process.stdin.isTTY && process.stdout.isTTY;
    const result = interactive
      ? await runProcessInteractiveCapsuleExec(execInput)
      : await execCapsule(execInput);
    if (result.kind !== 'capsule-exec-completed') {
      if (flags.json) {
        process.stdout.write(`${capsuleFailure({ result, json: true })}\n`);
        this.exit(1);
      }
      this.error(capsuleFailure({ result, json: false }), { exit: 1 });
    }
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
      const captured = processOutcome(result.outcome);
      if (captured === null) {
        this.exit(1);
      }
      if (captured.kind === 'exited' && captured.exitCode !== 0) {
        this.exit(captured.exitCode);
      }
      if (captured.kind !== 'exited') {
        this.exit(captured.kind === 'executable-not-found' ? 127 : 1);
      }
      return;
    }
    process.stderr.write(`[blackbox] Activity retained: ${result.activityId}\n`);
    finishProcess(this, result.outcome, interactive ? { kind: 'streamed' } : { kind: 'captured' });
  }
}
