import { Help } from '@oclif/core';

import { ROOT_HELP_ORDER } from './command-registry.js';

/**
 * Root help lists every visible command by its full name instead of topics,
 * so the whole surface is readable in one screen.
 */
export default class BlackboxHelp extends Help {
  protected override async showRootHelp(): Promise<void> {
    await Promise.resolve();
    const visible = this.config.commands
      .filter((command) => !command.hidden)
      .sort((left, right) => ROOT_HELP_ORDER.indexOf(left.id) - ROOT_HELP_ORDER.indexOf(right.id));
    this.log(this.formatRoot());
    this.log('');
    this.log(this.formatCommands(visible));
    this.log('');
  }
}
