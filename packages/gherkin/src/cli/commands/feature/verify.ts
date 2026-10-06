import { Command, Flags } from '@oclif/core';

import { library } from '../../../library/index.js';
import { renderVerify } from '../../../verify/render.js';
import { verifyRun } from '../../../verify/verify.js';
import { configFlag, EXIT, projectAt } from '../../project.js';

export default class FeatureVerify extends Command {
  static override description =
    'Verify a finished run: every compiled scenario ran once and is supported, the runner policy matches its baseline, and nothing changed since compile.';

  static override flags = {
    config: configFlag,
    json: Flags.boolean({ description: 'print the result as one JSON document', default: false }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(FeatureVerify);
    const result = await verifyRun({ project: projectAt(flags.config), library });
    this.log(flags.json ? JSON.stringify(result) : renderVerify(result));
    if (!result.ok) {
      this.exit(EXIT.failed);
    }
  }
}
