import { Command, Flags } from '@oclif/core';

import { library } from '../../../library/index.js';
import { renderVocabulary, vocabularyJson } from '../../vocabulary.js';

export default class FeatureSteps extends Command {
  static override description = 'List the shared step library: every step a feature may use, with an example.';

  static override flags = {
    json: Flags.boolean({ description: 'print the vocabulary as one JSON document', default: false }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(FeatureSteps);
    this.log(flags.json ? vocabularyJson(library) : renderVocabulary(library));
  }
}
