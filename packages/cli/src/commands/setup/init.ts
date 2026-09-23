import { Flags } from '@oclif/core';
import { StubCommand } from '../../stub-command.js';

export default class SetupInit extends StubCommand {
  static override description = 'Initialize project setup and retain diagnostics.';
  static override flags = { json: Flags.boolean({ default: false }) };
  readonly capability = 'Project setup has no backend yet.';
}
