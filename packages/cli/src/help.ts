import { Help, type Command } from '@oclif/core';

import { ROOT_HELP_ORDER } from './command-registry.js';

/**
 * Root help lists every visible command by its full name (for example
 * `catalog validate`) instead of topics, so hidden aliases never surface
 * through a topic.
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

  /**
   * A hidden alias topic (for example `capsule report`) keeps listing its own
   * hidden alias actions, as it did before the aliases were hidden.
   */
  public override async showCommandHelp(command: Command.Loadable): Promise<void> {
    // oclif's formatters rewrite `id` in place (':' → ' '); read it first.
    const id = command.id;
    await super.showCommandHelp(command);
    if (!command.hidden) {
      return;
    }
    const children = this.config.commands.filter(
      (candidate) =>
        candidate.id.startsWith(`${id}:`) && !candidate.id.slice(id.length + 1).includes(':'),
    );
    if (children.length > 0) {
      this.log('COMMANDS');
      this.log(this.formatCommands(children));
      this.log('');
    }
  }
}
