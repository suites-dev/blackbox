import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';

import SkillsInstall from './install.js';

/**
 * A minimal oclif root, so the test runs the command class from source and never
 * loads this package's built command registry.
 */
let oclifRoot = '';
beforeAll(async () => {
  oclifRoot = await mkdtemp(join(tmpdir(), 'blackbox-skills-oclif-'));
  await writeFile(
    join(oclifRoot, 'package.json'),
    JSON.stringify({ name: 'skills-command-test', version: '0.0.0', oclif: {} }),
  );
});
afterAll(async () => {
  await rm(oclifRoot, { recursive: true, force: true });
});

interface Run {
  readonly exit: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** The exit code oclif attached to a thrown exit or error, or -1 for anything else. */
function oclifExit(error: unknown): number {
  const oclif =
    typeof error === 'object' && error !== null
      ? (error as Record<string, unknown>).oclif
      : undefined;
  const exit =
    typeof oclif === 'object' && oclif !== null
      ? (oclif as Record<string, unknown>).exit
      : undefined;
  return typeof exit === 'number' ? exit : -1;
}

/** Runs the command in `directory` and returns its exit code and captured output. */
async function run(directory: string, ...argv: string[]): Promise<Run> {
  let stdout = '';
  let stderr = '';
  vi.spyOn(process, 'cwd').mockReturnValue(directory);
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  });
  vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
    stdout += `${parts.map(String).join(' ')}\n`;
  });
  vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
    stderr += `${parts.map(String).join(' ')}\n`;
  });
  let exit = 0;
  try {
    await SkillsInstall.run(argv, oclifRoot);
  } catch (error) {
    exit = oclifExit(error);
    if (exit === -1) {
      throw error;
    }
    // oclif's static run leaves rendering a failure to the bin's error handler.
    stderr += `${(error as Error).message}\n`;
  } finally {
    vi.restoreAllMocks();
  }
  return { exit, stdout, stderr };
}

async function project(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'blackbox-skills-command-'));
}

const created: string[] = [];
afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it('--json prints one document and exits 0 for a fresh install, then reports unchanged', async () => {
  const directory = await project();
  created.push(directory);
  const first = await run(directory, 'discovery', '--codex', '--claude', '--json');
  expect(first.exit).toBe(0);
  const lines = first.stdout.split('\n');
  expect(lines).toHaveLength(2);
  const document = JSON.parse(lines[0]) as Record<string, unknown>;
  expect(document).toMatchObject({ kind: 'skill-install', ok: true, skill: 'discovery' });
  expect(document.results).toEqual([
    { kind: 'installed', agent: 'codex', path: join(directory, '.agents/skills/discovery') },
    { kind: 'installed', agent: 'claude', path: join(directory, '.claude/skills/discovery') },
  ]);
  expect((document.warnings as { code: string }[]).map(({ code }) => code)).toEqual([
    'cursor-duplicate-listing',
  ]);
  const repeat = await run(directory, 'discovery', '--agent', 'codex', '--agent', 'cursor');
  expect(repeat.exit).toBe(0);
  expect(repeat.stdout).toContain(
    `codex: unchanged ${join(directory, '.agents/skills/discovery')}`,
  );
  expect(repeat.stdout).toContain(
    `cursor: unchanged ${join(directory, '.agents/skills/discovery')}`,
  );
});

it('a conflict changes nothing, tells the user to move or remove the directory, and exits 1', async () => {
  const directory = await project();
  created.push(directory);
  await run(directory, 'discovery', '--claude');
  const skill = join(directory, '.claude/skills/discovery/SKILL.md');
  await writeFile(skill, '# my edits\n');
  const human = await run(directory, 'discovery', '--claude');
  expect(human.exit).toBe(1);
  expect(human.stdout).toContain('claude: conflict');
  expect(human.stdout).toContain('SKILL.md modified');
  expect(human.stderr).toMatch(/move or remove it, then rerun/u);
  const json = await run(directory, 'discovery', '--claude', '--json');
  expect(json.exit).toBe(1);
  expect(json.stdout.split('\n')).toHaveLength(2);
  expect(JSON.parse(json.stdout)).toMatchObject({ ok: false, results: [{ kind: 'conflict' }] });
  expect(await readFile(skill, 'utf8')).toBe('# my edits\n');
});

it('--yes selects every agent; no agent without a terminal is a usage error', async () => {
  const directory = await project();
  created.push(directory);
  const none = await run(directory, 'discovery', '--json');
  expect(none.exit).toBe(2);
  const all = await run(directory, 'discovery', '--yes', '--json');
  expect(all.exit).toBe(0);
  expect(
    (JSON.parse(all.stdout) as { results: { agent: string }[] }).results.map(({ agent }) => agent),
  ).toEqual(['codex', 'cursor', 'claude']);
});
