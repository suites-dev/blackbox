import { Command, Flags } from '@oclif/core';

import { checkChange, renderChangeCheck } from '../../../check/change.js';
import { configFlag, EXIT, projectAt } from '../../project.js';

export default class FeatureCheckChange extends Command {
  static override description =
    'Fail when one change alters both spec paths (features, project file, policy baseline, step library) and code paths.';

  static override flags = {
    config: configFlag,
    base: Flags.string({ description: 'the ref the change is compared with, such as origin/main', required: true }),
    head: Flags.string({ description: 'the ref of the change', default: 'HEAD' }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(FeatureCheckChange);
    const check = await checkChange(projectAt(flags.config), { base: flags.base, head: flags.head });
    this.log(renderChangeCheck(check));
    if (check.problem !== null) {
      this.exit(EXIT.failed);
    }
  }
}
