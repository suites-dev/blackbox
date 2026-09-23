import { Flags } from '@oclif/core';
import { StubCommand } from '../stub-command.js';

export default class Observations extends StubCommand {
  static override description = 'Query retained raw observations.';
  static override flags = { session: Flags.string({ required: true }), json: Flags.boolean({ default: false }) };
  readonly capability = 'Observation queries have no backend yet.';
}
