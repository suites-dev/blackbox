import { Args, Flags } from '@oclif/core';
import { StubCommand } from '../../stub-command.js';

export default class SkillInstall extends StubCommand {
  static override description = 'Install the discovery skill into the current project.';
  static override args = { name: Args.string({ required: true, description: 'Skill name (discovery)' }) };
  static override flags = { json: Flags.boolean({ default: false }) };
  readonly capability = 'Discovery skill installation has no backend yet.';
}
