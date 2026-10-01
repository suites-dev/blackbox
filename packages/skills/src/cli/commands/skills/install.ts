import { Args, Command, Flags } from '@oclif/core';
import { readCliSkillModules } from '@suites/blackbox-cli-contract';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

import { SKILL_AGENTS, installSkill, type SkillAgent } from '../../../installation/install.js';
import { createSkillRegistry } from '../../../registry/registry.js';
import {
  skillInstallDocument,
  skillInstallFailure,
  skillInstallLines,
} from '../../skill-install-output.js';

export default class SkillsInstall extends Command {
  static override description =
    'Install a contributed Blackbox workflow Skill into the current directory. ' +
    'codex and cursor read .agents/skills/, claude reads .claude/skills/. Directories that ' +
    'Blackbox did not install, or that changed since it installed them, are left untouched.';
  static override args = { name: Args.string({ required: true }) };
  static override flags = {
    agent: Flags.string({ multiple: true, options: [...SKILL_AGENTS] }),
    codex: Flags.boolean({ default: false }),
    claude: Flags.boolean({ default: false }),
    cursor: Flags.boolean({ default: false }),
    yes: Flags.boolean({ default: false }),
    json: Flags.boolean({ default: false }),
    gitignore: Flags.boolean({
      default: false,
      description: 'Ignore successful skill copies in the project .gitignore.',
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(SkillsInstall);
    const modules = readCliSkillModules(this.config);
    const registry = createSkillRegistry(modules);
    if (registry.get(args.name) === null) {
      this.error(`Skill is unavailable in the selected plugins: ${args.name}`, { exit: 2 });
    }
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
        `Install ${args.name} for Codex, Claude Code, and Cursor? [Y/n] `,
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
      await installSkill(
        { projectDirectory: process.cwd(), skillName: args.name, agents },
        registry,
        { gitignore: flags.gitignore },
      ),
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
