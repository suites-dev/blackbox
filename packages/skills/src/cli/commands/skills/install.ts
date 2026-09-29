import { Args, Command, Flags } from '@oclif/core';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { BUNDLED_SKILLS } from '../../../installation/bundled-skill.js';
import { SKILL_AGENTS, installSkill, type SkillAgent } from '../../../installation/install.js';
import {
  skillInstallDocument,
  skillInstallFailure,
  skillInstallLines,
} from '../../skill-install-output.js';

export default class SkillsInstall extends Command {
  static override description =
    'Install a Blackbox workflow Skill for coding agents into the current directory. ' +
    'codex and cursor read .agents/skills/, claude reads .claude/skills/. Directories that ' +
    'Blackbox did not install, or that changed since it installed them, are left untouched.';
  static override args = {
    name: Args.string({ required: true, options: [...BUNDLED_SKILLS] }),
  };
  static override flags = {
    agent: Flags.string({ multiple: true, options: [...SKILL_AGENTS] }),
    codex: Flags.boolean({ default: false }),
    claude: Flags.boolean({ default: false }),
    cursor: Flags.boolean({ default: false }),
    yes: Flags.boolean({ default: false }),
    json: Flags.boolean({ default: false }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(SkillsInstall);
    const agents = [
      ...new Set([
        ...(flags.agent ?? []),
        ...(flags.codex ? ['codex' as const] : []),
        ...(flags.claude ? ['claude' as const] : []),
        ...(flags.cursor ? ['cursor' as const] : []),
      ]),
    ] as SkillAgent[];
    if (agents.length === 0 && flags.yes) {
      agents.push(...SKILL_AGENTS);
    }
    if (agents.length === 0 && !flags.json && stdin.isTTY && stdout.isTTY) {
      const prompt = createInterface({ input: stdin, output: stdout });
      const answer = await prompt.question(
        'Install Discovery for Codex, Claude Code, and Cursor? [Y/n] ',
      );
      prompt.close();
      if (answer.trim() === '' || /^y(es)?$/iu.test(answer.trim())) {
        agents.push(...SKILL_AGENTS);
      }
    }
    if (agents.length === 0) {
      this.error('Choose an agent with --codex, --claude, --cursor, or --agent.', { exit: 2 });
    }
    const document = skillInstallDocument(
      await installSkill({
        projectDirectory: process.cwd(),
        skillName: args.name as (typeof BUNDLED_SKILLS)[number],
        agents,
      }),
    );
    const failure = skillInstallFailure(document);
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(document)}\n`);
      if (failure !== null) {
        this.exit(1);
      }
      return;
    }
    for (const line of skillInstallLines(document)) {
      this.log(line);
    }
    if (failure !== null) {
      this.error(failure, { exit: 1 });
    }
  }
}
