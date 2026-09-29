import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { INSTALL_RECORD_NAME } from './install-record.js';
import type { SkillBundle } from './install-skill.js';
import { readSkillTree } from './store/node-skill-store.js';

/** Skills this package ships under `assets/`. */
export const BUNDLED_SKILLS = ['discovery'] as const;

export type BundledSkill = (typeof BUNDLED_SKILLS)[number];

/** The package root, from both `src/installation` and `dist/installation`. */
const packageRoot = new URL('../../', import.meta.url);

async function packageVersion(): Promise<string> {
  const manifest = JSON.parse(
    await readFile(new URL('package.json', packageRoot), 'utf8'),
  ) as unknown;
  const version =
    typeof manifest === 'object' && manifest !== null
      ? (manifest as Record<string, unknown>).version
      : undefined;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('The skills package manifest has no version');
  }
  return version;
}

/**
 * Loads a skill shipped in this package. Nothing is downloaded and nothing in
 * the skill is executed; the bundle's version is this package's version.
 */
export async function loadBundledSkill(
  name: BundledSkill,
  directory = fileURLToPath(new URL(`assets/${name}`, packageRoot)),
): Promise<SkillBundle> {
  let files: Map<string, Uint8Array>;
  try {
    files = await readSkillTree(directory);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`The skills package does not contain a usable ${name} skill: ${reason}`);
  }
  if (!files.has('SKILL.md') || files.has(INSTALL_RECORD_NAME)) {
    throw new Error(`The skills package's bundled ${name} skill is malformed: ${directory}`);
  }
  return { name, version: await packageVersion(), files };
}
