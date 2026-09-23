import { Flags } from '@oclif/core';
import { StubCommand } from '../stub-command.js';

export default class History extends StubCommand {
  static override description = 'List exact execution and Capsule records.';
  static override flags = { json: Flags.boolean({ default: false }) };
  readonly capability = 'Execution history has no backend yet.';
}
