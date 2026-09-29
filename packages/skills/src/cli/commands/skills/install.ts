import { Args, Command, Flags } from '@oclif/core';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { installSkill, type SkillAgent } from '../../../installation/install.js';

const AGENTS = ['codex', 'claude', 'cursor'] as const satisfies readonly SkillAgent[];

export default class SkillsInstall extends Command {
  static override description = 'Install a Blackbox workflow Skill for coding agents.';
  static override args = {
    name: Args.string({ required: true, options: ['discovery'] }),
  };
  static override flags = {
    agent: Flags.string({ multiple: true, options: [...AGENTS] }),
    codex: Flags.boolean({ default: false }),
    claude: Flags.boolean({ default: false }),
    cursor: Flags.boolean({ default: false }),
    yes: Flags.boolean({ default: false }),
    json: Flags.boolean({ default: false }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(SkillsInstall);
    const agents = [...new Set([
      ...(flags.agent ?? []),
      ...(flags.codex ? ['codex' as const] : []),
      ...(flags.claude ? ['claude' as const] : []),
      ...(flags.cursor ? ['cursor' as const] : []),
    ])] as SkillAgent[];
    if (agents.length === 0 && flags.yes) {
      agents.push(...AGENTS);
    }
    if (agents.length === 0 && stdin.isTTY && stdout.isTTY) {
      const prompt = createInterface({ input: stdin, output: stdout });
      const answer = await prompt.question('Install Discovery for Codex, Claude Code, and Cursor? [Y/n] ');
      prompt.close();
      if (answer.trim() === '' || /^y(es)?$/iu.test(answer.trim())) {agents.push(...AGENTS);}
    }
    if (agents.length === 0) {
      this.error('Choose an agent with --codex, --claude, --cursor, or --agent.', { exit: 2 });
    }
    const results = await installSkill({
      projectDirectory: process.cwd(),
      skillName: args.name as 'discovery',
      agents,
    });
    const conflict = results.find((result) => result.kind === 'conflict');
    if (flags.json) {
      this.log(JSON.stringify({ kind: 'skill-install', skill: args.name, results }));
    } else {
      for (const result of results) {this.log(`${result.agent}: ${result.kind} ${result.path}`);}
    }
    if (conflict !== undefined) {this.error(`Skill path already contains different files: ${conflict.path}`, { exit: 1 });}
  }
}
