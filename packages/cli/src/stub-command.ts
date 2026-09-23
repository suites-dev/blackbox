import { Command } from '@oclif/core';
import { failClosed } from './stub.js';

export abstract class StubCommand extends Command {
  public abstract readonly capability: string;
  public async run(): Promise<void> {
    await this.parse(this.constructor as typeof StubCommand);
    failClosed(this, this.capability);
  }
}
