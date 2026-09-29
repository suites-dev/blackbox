import { cp, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type SkillAgent = 'codex' | 'claude' | 'cursor';

type InstallResult =
  | { readonly kind: 'installed'; readonly agent: SkillAgent; readonly path: string }
  | { readonly kind: 'unchanged'; readonly agent: SkillAgent; readonly path: string }
  | { readonly kind: 'conflict'; readonly agent: SkillAgent; readonly path: string };

const AGENT_DIRECTORIES = {
  codex: '.agents/skills',
  claude: '.claude/skills',
  cursor: '.cursor/skills',
} as const satisfies Readonly<Record<SkillAgent, string>>;

const skillSource = fileURLToPath(new URL('../../assets/discovery', import.meta.url));

async function sameTree(source: string, target: string): Promise<boolean> {
  const sourceStat = await stat(source);
  const targetStat = await stat(target).catch(() => null);
  if (targetStat === null || sourceStat.isDirectory() !== targetStat.isDirectory()) {return false;}
  if (sourceStat.isDirectory()) {
    const [sourceNames, targetNames] = await Promise.all([readdir(source), readdir(target)]);
    if (sourceNames.length !== targetNames.length) {return false;}
    for (const name of sourceNames) {
      if (!(await sameTree(join(source, name), join(target, name)))) {return false;}
    }
    return true;
  }
  return (await readFile(source)).equals(await readFile(target));
}

export async function installSkill(input: {
  readonly projectDirectory: string;
  readonly skillName: 'discovery';
  readonly agents: readonly SkillAgent[];
}): Promise<readonly InstallResult[]> {
  const results: InstallResult[] = [];
  for (const agent of input.agents) {
    const target = join(input.projectDirectory, AGENT_DIRECTORIES[agent], input.skillName);
    const existing = await stat(target).catch(() => null);
    if (existing !== null) {
      if (await sameTree(skillSource, target)) {
        results.push({ kind: 'unchanged', agent, path: target });
      } else {
        results.push({ kind: 'conflict', agent, path: target });
      }
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await cp(skillSource, target, { recursive: true });
    results.push({ kind: 'installed', agent, path: target });
  }
  return results;
}
