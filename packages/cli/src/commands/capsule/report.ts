import { Command, loadHelpClass } from '@oclif/core';

export default class CapsuleReport extends Command {
  static override hidden = true;
  static override description = 'Serve live Capsule reports or export a portable snapshot.';

  public async run(): Promise<void> {
    await this.parse(CapsuleReport);
    const BlackboxHelp = await loadHelpClass(this.config);
    await new BlackboxHelp(this.config).showHelp(['capsule', 'report']);
  }
}
