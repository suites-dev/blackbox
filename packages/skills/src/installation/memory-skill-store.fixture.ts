import {
  SkillStoreError,
  installSkillBundle,
  type SkillBundle,
  type SkillStore,
  type StoredSkill,
} from './install-skill.js';
import type { SkillAgent } from './hosts.js';
import { INSTALL_RECORD_NAME, decodeInstallRecord, type InstallRecord } from './install-record.js';

export const text = (value: string) => Buffer.from(value);

function sameStored(left: StoredSkill, right: StoredSkill): boolean {
  if (left.kind !== 'directory' || right.kind !== 'directory') {
    return left.kind === right.kind;
  }
  return (
    left.files.size === right.files.size &&
    [...left.files].every(([path, content]) => {
      const other = right.files.get(path);
      return other !== undefined && Buffer.from(content).equals(other);
    })
  );
}

export function bundle(version: string, skill = '# discovery v1\n'): SkillBundle {
  return {
    name: 'discovery',
    version,
    files: new Map([
      ['SKILL.md', text(skill)],
      ['references/ci.md', text('ci\n')],
    ]),
  };
}

type Operation = 'read' | 'replace';

/** Skill directories kept in memory; `failures` makes one path's operation throw. */
export class MemoryStore implements SkillStore {
  readonly directories = new Map<string, Map<string, Uint8Array>>();
  readonly others = new Set<string>();
  readonly failures = new Map<string, { operation: Operation; error: Error }>();
  writes = 0;

  read(path: string): Promise<StoredSkill> {
    this.#fail(path, 'read');
    if (this.others.has(path)) {
      return Promise.resolve({ kind: 'other' });
    }
    const files = this.directories.get(path);
    return Promise.resolve(
      files === undefined ? { kind: 'absent' } : { kind: 'directory', files: new Map(files) },
    );
  }

  async replace(
    path: string,
    files: ReadonlyMap<string, Uint8Array>,
    expected: StoredSkill,
  ): Promise<void> {
    this.#fail(path, 'replace');
    if (!sameStored(await this.read(path), expected)) {
      throw new SkillStoreError('changed-during-install', `${path} changed while installing`);
    }
    this.writes += 1;
    this.others.delete(path);
    this.directories.set(path, new Map(files));
  }

  file(path: string, name: string): string | undefined {
    const content = this.tree(path).get(name);
    return content === undefined ? undefined : Buffer.from(content).toString('utf8');
  }

  tree(path: string): Map<string, Uint8Array> {
    const files = this.directories.get(path);
    if (files === undefined) {
      throw new Error(`no skill directory at ${path}`);
    }
    return files;
  }

  #fail(path: string, operation: Operation): void {
    const failure = this.failures.get(path);
    if (failure !== undefined && failure.operation === operation) {
      throw failure.error;
    }
  }
}

export async function install(
  store: SkillStore,
  input: Partial<{ bundle: SkillBundle; agents: SkillAgent[] }> = {},
) {
  return await installSkillBundle({
    bundle: input.bundle ?? bundle('1.0.0'),
    agents: input.agents ?? ['codex'],
    store,
  });
}

/** The decoded install record at a destination; throws when absent or malformed. */
export function recordAt(store: MemoryStore, path: string): InstallRecord {
  const record = decodeInstallRecord(text(store.file(path, INSTALL_RECORD_NAME) ?? ''));
  if (record === null) {
    throw new Error(`no valid install record at ${path}`);
  }
  return record;
}
