import { constants } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, open, readdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverySkill } from '../discovery.js';
import { createSkillRegistry } from '../registry/registry.js';
import type { ResolvedSkillRegistry } from '../registry/contracts.js';
import { validateSkillSource } from './source.js';

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

const defaultRegistry = createSkillRegistry([
  { apiVersion: 1, packageName: '@suites/blackbox-skills', skills: [discoverySkill] },
]);

async function sameTree(source: string, target: string): Promise<boolean> {
  const sourceHandle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW).catch(
    () => null,
  );
  const targetHandle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW).catch(
    () => null,
  );
  if (sourceHandle === null || targetHandle === null) {
    if (sourceHandle !== null) {
      await sourceHandle.close();
    }
    if (targetHandle !== null) {
      await targetHandle.close();
    }
    return false;
  }
  try {
    const [sourceStat, targetStat] = await Promise.all([sourceHandle.stat(), targetHandle.stat()]);
    if (sourceStat.isDirectory() !== targetStat.isDirectory()) {
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
    return (await sourceHandle.readFile()).equals(await targetHandle.readFile());
  } finally {
    await Promise.all([sourceHandle.close(), targetHandle.close()]);
  }
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
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error.code === 'EEXIST' || error.code === 'ENOTEMPTY')
      ) {
        return 'occupied';
      }
      throw error;
    }
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}

export async function installSkill(
  input: {
    readonly projectDirectory: string;
    readonly skillName: string;
    readonly agents: readonly SkillAgent[];
  },
  registry: ResolvedSkillRegistry = defaultRegistry,
): Promise<readonly InstallResult[]> {
  const selected = registry.resolve([input.skillName]);
  const targets: { source: string; target: string; agent: SkillAgent }[] = [];
  for (const skill of selected) {
    const source = fileURLToPath(skill.source);
    await validateSkillSource(source);
    for (const agent of new Set(input.agents)) {
      if (!Object.hasOwn(AGENT_DIRECTORIES, agent)) {
        throw new Error(`Unknown skill agent: ${agent}`);
      }
      const target = join(input.projectDirectory, AGENT_DIRECTORIES[agent], skill.name);
      await assertSafeParents(input.projectDirectory, target);
      targets.push({ source, target, agent });
    }
  }
  const conflicts: InstallResult[] = [];
  for (const { source, target, agent } of targets) {
    if ((await lstat(target).catch(() => null)) !== null && !(await sameTree(source, target))) {
      conflicts.push({ kind: 'conflict', agent, path: target });
    }
  }
  if (conflicts.length > 0) {
    return conflicts;
  }
  return publishTargets(input.projectDirectory, targets);
}

async function publishTargets(
  projectDirectory: string,
  targets: readonly { source: string; target: string; agent: SkillAgent }[],
): Promise<readonly InstallResult[]> {
  const results: InstallResult[] = [];
  for (const { source: skillSource, target, agent } of targets) {
    const existing = await lstat(target).catch(() => null);
    if (existing !== null) {
      results.push({
        kind: (await sameTree(skillSource, target)) ? 'unchanged' : 'conflict',
        agent,
        path: target,
      });
      continue;
    }
    const publication = await publishSkill(skillSource, target, projectDirectory);
    const kind =
      publication === 'installed'
        ? 'installed'
        : (await sameTree(skillSource, target))
          ? 'unchanged'
          : 'conflict';
    results.push({ kind, agent, path: target });
  }
  return results;
}
