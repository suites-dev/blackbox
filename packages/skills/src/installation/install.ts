import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
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
  const sourceStat = await lstat(source);
  const targetStat = await lstat(target).catch(() => null);
  if (
    targetStat === null ||
    sourceStat.isSymbolicLink() ||
    targetStat.isSymbolicLink() ||
    sourceStat.isDirectory() !== targetStat.isDirectory()
  ) {
    return false;
  }
  if (sourceStat.isDirectory()) {
    const [sourceNames, targetNames] = await Promise.all([readdir(source), readdir(target)]);
    if (sourceNames.length !== targetNames.length) {
      return false;
    }
    for (const name of sourceNames) {
      if (!(await sameTree(join(source, name), join(target, name)))) {
        return false;
      }
    }
    return true;
  }
  return (await readFile(source)).equals(await readFile(target));
}

async function assertSafeParents(projectDirectory: string, target: string): Promise<void> {
  const root = resolve(projectDirectory);
  const targetPath = resolve(target);
  if (relative(root, targetPath).startsWith('..')) {
    throw new Error('skill target escapes the project directory');
  }
  let current = dirname(targetPath);
  while (current !== root && current !== dirname(current)) {
    const entry = await lstat(current).catch(() => null);
    if (entry !== null && entry.isSymbolicLink()) {
      throw new Error(`skill target parent is a symbolic link: ${current}`);
    }
    current = dirname(current);
  }
}

/** Stage the complete tree and publish it with one rename, so no checked path is copied into. */
async function publishSkill(
  source: string,
  target: string,
  projectDirectory: string,
): Promise<'installed' | 'occupied'> {
  await assertSafeParents(projectDirectory, target);

  const parent = dirname(target);
  await mkdir(parent, { recursive: true });
  const stagingDirectory = await mkdtemp(join(parent, `.${basename(target)}.tmp-`));
  const stagedTarget = join(stagingDirectory, basename(target));
  try {
    await cp(source, stagedTarget, { recursive: true });
    try {
      await rename(stagedTarget, target);
      return 'installed';
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
        return 'occupied';
      }
      throw error;
    }
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}

export async function installSkill(input: {
  readonly projectDirectory: string;
  readonly skillName: 'discovery';
  readonly agents: readonly SkillAgent[];
}): Promise<readonly InstallResult[]> {
  const results: InstallResult[] = [];
  for (const agent of input.agents) {
    const target = join(input.projectDirectory, AGENT_DIRECTORIES[agent], input.skillName);
    const existing = await lstat(target).catch(() => null);
    if (existing !== null) {
      results.push({
        kind: (await sameTree(skillSource, target)) ? 'unchanged' : 'conflict',
        agent,
        path: target,
      });
      continue;
    }
    const publication = await publishSkill(skillSource, target, input.projectDirectory);
    const kind = publication === 'installed'
      ? 'installed'
      : (await sameTree(skillSource, target) ? 'unchanged' : 'conflict');
    results.push({ kind, agent, path: target });
  }
  return results;
}
