import { Command, Help } from '@oclif/core';

export default class CapsuleReport extends Command {
  static override description = 'Serve live Capsule reports or export a portable snapshot.';

  public async run(): Promise<void> {
    await this.parse(CapsuleReport);
    await new Help(this.config).showHelp(['capsule', 'report']);
  }
}
