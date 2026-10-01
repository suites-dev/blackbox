import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RegisteredSkillDefinition } from '../registry/contracts.js';
import { INSTALL_RECORD_NAME } from './install-record.js';
import type { SkillBundle } from './install-skill.js';
import { readSkillTree } from './store/node-skill-store.js';

export interface LoadedSkillBundle {
  readonly bundle: SkillBundle;
  readonly packageName: string;
}

function containedPath(root: string, source: string): boolean {
  const path = relative(root, source);
  return path !== '' && !path.startsWith('..') && !isAbsolute(path);
}

async function withinPackage(skill: RegisteredSkillDefinition): Promise<string> {
  const root = fileURLToPath(skill.packageRoot);
  const source = fileURLToPath(skill.source);
  if (!containedPath(root, source)) {
    throw new Error(`Skill source is outside its package: ${skill.name}`);
  }
  const [canonicalRoot, canonicalSource] = await Promise.all([realpath(root), realpath(source)]);
  if (!containedPath(canonicalRoot, canonicalSource)) {
    throw new Error(`Skill source is outside its package: ${skill.name}`);
  }
  return source;
}

async function packageVersion(skill: RegisteredSkillDefinition): Promise<string> {
  const manifest = JSON.parse(
    await readFile(new URL('package.json', skill.packageRoot), 'utf8'),
  ) as unknown;
  const record =
    typeof manifest === 'object' && manifest !== null ? (manifest as Record<string, unknown>) : {};
  if (record.name !== skill.packageName || typeof record.version !== 'string') {
    throw new Error(`Skill package manifest does not match ${skill.packageName}`);
  }
  return record.version;
}

/** Load a selected package's declared skill without downloading or executing its assets. */
export async function loadRegisteredSkill(
  skill: RegisteredSkillDefinition,
): Promise<LoadedSkillBundle> {
  const directory = await withinPackage(skill);
  const source = await lstat(directory);
  if (!source.isDirectory() || source.isSymbolicLink()) {
    throw new Error(`Skill source is not an ordinary directory: ${directory}`);
  }
  const files = await readSkillTree(directory);
  if (!files.has('SKILL.md') || files.has(INSTALL_RECORD_NAME)) {
    throw new Error(`The ${skill.packageName} package contains a malformed ${skill.name} skill`);
  }
  return {
    bundle: {
      name: skill.name,
      packageName: skill.packageName,
      version: await packageVersion(skill),
      files,
    },
    packageName: skill.packageName,
  };
}
