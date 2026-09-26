import { Command, Flags } from '@oclif/core';
import { readCapsuleObservations } from '@suites/blackbox-capsule-internal';

export default class Observations extends Command {
  static override description = 'Query exact retained raw observations.';
  static override flags = {
    session: Flags.string({ required: true }),
    activity: Flags.string(),
    trace: Flags.string(),
    json: Flags.boolean({ default: false }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Observations);
    if (flags.activity !== undefined && flags.trace !== undefined) {
      this.error('--activity and --trace cannot be used together', { exit: 2 });
    }
    const selection =
      flags.activity !== undefined
        ? { kind: 'activity' as const, activityId: flags.activity }
        : flags.trace !== undefined
          ? { kind: 'trace' as const, traceId: flags.trace }
          : { kind: 'session' as const };
    const result = await readCapsuleObservations({
      projectDirectory: process.cwd(),
      sessionId: flags.session,
      selection,
    });
    if (result.kind.startsWith('capsule-')) {
      this.error(JSON.stringify(result), { exit: 1 });
    }
    this.log(JSON.stringify(result, null, flags.json ? 0 : 2));
  }
}
