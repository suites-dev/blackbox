import { Command, Flags } from '@oclif/core';
import { stopCapsule } from '@suites/blackbox-capsule-internal';
import { capsuleFailure } from '../../capsule-output.js';

export default class CapsuleStop extends Command {
  static override description = 'Stop a Capsule and finalize its durable record.';
  static override flags = { session: Flags.string({ required: true }), json: Flags.boolean({ default: false }) };
  public async run(): Promise<void> { const { flags } = await this.parse(CapsuleStop); const result = await stopCapsule({ projectDirectory: process.cwd(), sessionId: flags.session, reason: 'completed' }); if (result.kind !== 'capsule-stopped') { if (flags.json) {this.log(capsuleFailure({ result, json: true }));} this.error(capsuleFailure({ result, json: false }), { exit: 1 }); } if (flags.json) {this.log(JSON.stringify(result));} else {this.log(`Capsule ${result.sessionId} stopped.`);} }
}
