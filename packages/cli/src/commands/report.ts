import { Flags } from '@oclif/core';
import { StubCommand } from '../stub-command.js';

export default class Report extends StubCommand {
  static override description = 'Render a retained report.';
  static override flags = { run: Flags.string(), json: Flags.boolean({ default: false }) };
  readonly capability = 'Report projection has no backend yet.';
}
