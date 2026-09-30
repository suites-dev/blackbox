import { skillDestinations, type SkillAgent } from './hosts.js';
import {
  INSTALL_RECORD_NAME,
  decodeInstallRecord,
  encodeInstallRecord,
  fileHashes,
  type InstallRecord,
} from './install-record.js';

/** The skill tree shipped in this package, versioned with the package. */
export interface SkillBundle {
  readonly name: string;
  readonly version: string;
  /** Skill-relative `/` path → content. Never contains the install record. */
  readonly files: ReadonlyMap<string, Uint8Array>;
}

export type StoredSkill =
  | { readonly kind: 'absent' }
  | { readonly kind: 'directory'; readonly files: ReadonlyMap<string, Uint8Array> }
  /** A file or other non-directory entry occupies the destination. */
  | { readonly kind: 'other' };

export type SkillFailureReason =
  'unsafe-path' | 'permission-denied' | 'io-error' | 'changed-during-install';

/** A store failure the installer reports as a `failed` destination. */
export class SkillStoreError extends Error {
  constructor(
    readonly reason: SkillFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'SkillStoreError';
  }
}

/** Project-relative skill directories. `replace` and `writeRecord` must be all-or-nothing. */
export interface SkillStore {
  read(path: string): Promise<StoredSkill>;
  /**
   * Writes `files` at `path` only if it still holds `expected`, the state `read`
   * returned when the destination was assessed; otherwise it throws
   * `changed-during-install` and leaves the destination as it is.
   */
  replace(
    path: string,
    files: ReadonlyMap<string, Uint8Array>,
    expected: StoredSkill,
  ): Promise<void>;
  /** Adds the install record to an existing directory without touching its other files. */
  writeRecord(path: string, content: Uint8Array): Promise<void>;
}

export type SkillOutcome =
  'installed' | 'updated' | 'unchanged' | 'adopted' | 'conflict' | 'failed';

export type SkillOutcomeReason =
  'locally-modified' | 'not-installed-by-blackbox' | SkillFailureReason;

export interface SkillFileChange {
  readonly path: string;
  readonly change: 'modified' | 'added' | 'removed';
}

export interface SkillDestinationResult {
  readonly path: string;
  readonly agents: readonly SkillAgent[];
  readonly outcome: SkillOutcome;
  /** The version now at the destination; for a conflict, the recorded one (if any). */
  readonly version: string | null;
  /** The recorded version that was replaced (updated) or kept (conflict). */
  readonly from: string | null;
  readonly reason: SkillOutcomeReason | null;
  readonly message: string | null;
  readonly changes: readonly SkillFileChange[];
}

export interface SkillInstallResult {
  readonly destinations: readonly SkillDestinationResult[];
}

type Assessment =
  | { readonly kind: 'absent' }
  | { readonly kind: 'unrecorded'; readonly files: ReadonlyMap<string, Uint8Array> | null }
  | {
      readonly kind: 'recorded';
      readonly record: InstallRecord | null;
      readonly changes: readonly SkillFileChange[];
    };

function compareHashes(
  expected: Readonly<Record<string, string>>,
  actual: Readonly<Record<string, string>>,
): SkillFileChange[] {
  const expectedHashes = new Map(Object.entries(expected));
  const actualHashes = new Map(Object.entries(actual));
  const changes: SkillFileChange[] = [];
  for (const path of new Set([...expectedHashes.keys(), ...actualHashes.keys()])) {
    const wanted = expectedHashes.get(path);
    const found = actualHashes.get(path);
    if (wanted === undefined) {
      changes.push({ path, change: 'added' });
    } else if (found === undefined) {
      changes.push({ path, change: 'removed' });
    } else if (wanted !== found) {
      changes.push({ path, change: 'modified' });
    }
  }
  return changes.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

function assess(skill: string, stored: StoredSkill): Assessment {
  if (stored.kind === 'absent') {
    return { kind: 'absent' };
  }
  if (stored.kind === 'other') {
    return { kind: 'unrecorded', files: null };
  }
  const content = stored.files.get(INSTALL_RECORD_NAME);
  if (content === undefined) {
    return { kind: 'unrecorded', files: stored.files };
  }
  const record = decodeInstallRecord(content);
  if (record === null) {
    return {
      kind: 'recorded',
      record: null,
      changes: [{ path: INSTALL_RECORD_NAME, change: 'modified' }],
    };
  }
  if (record.skill !== skill) {
    return { kind: 'unrecorded', files: null };
  }
  const files = new Map(stored.files);
  files.delete(INSTALL_RECORD_NAME);
  return { kind: 'recorded', record, changes: compareHashes(record.files, fileHashes(files)) };
}

function sameFiles(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  return compareHashes(left, right).length === 0;
}

function recordFor(bundle: SkillBundle): Uint8Array {
  return encodeInstallRecord({
    skill: bundle.name,
    version: bundle.version,
    files: fileHashes(bundle.files),
  });
}

function installedFiles(bundle: SkillBundle): ReadonlyMap<string, Uint8Array> {
  const files = new Map(bundle.files);
  files.set(INSTALL_RECORD_NAME, recordFor(bundle));
  return files;
}

async function installDestination(input: {
  readonly bundle: SkillBundle;
  readonly path: string;
  readonly agents: readonly SkillAgent[];
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly store: SkillStore;
}): Promise<SkillDestinationResult> {
  const { bundle, path, agents } = input;
  const base = { path, agents, reason: null, message: null, changes: [] } as const;
  const failed = (error: unknown): SkillDestinationResult => ({
    ...base,
    outcome: 'failed',
    version: null,
    from: null,
    reason: error instanceof SkillStoreError ? error.reason : 'io-error',
    message: error instanceof Error ? error.message : String(error),
  });
  const conflict = (
    reason: 'locally-modified' | 'not-installed-by-blackbox',
    from: string | null,
    changes: readonly SkillFileChange[],
  ): SkillDestinationResult => ({
    ...base,
    outcome: 'conflict',
    version: from,
    from,
    reason,
    message:
      reason === 'locally-modified'
        ? `${path} has local changes since Blackbox installed it; move or remove it, then rerun`
        : `${path} exists but was not installed by Blackbox; move or remove it, then rerun`,
    changes,
  });
  const done = async (
    outcome: SkillOutcome,
    from: string | null,
    write: () => Promise<void>,
  ): Promise<SkillDestinationResult> => {
    try {
      await write();
    } catch (error) {
      return failed(error);
    }
    return { ...base, outcome, version: bundle.version, from };
  };

  let stored: StoredSkill;
  try {
    stored = await input.store.read(path);
  } catch (error) {
    return failed(error);
  }
  const assessment = assess(bundle.name, stored);
  if (assessment.kind === 'absent') {
    return await done('installed', null, () => input.store.replace(path, input.files, stored));
  }
  if (assessment.kind === 'unrecorded') {
    // A manual copy of exactly this version is adopted: only the record is added.
    return assessment.files !== null &&
      sameFiles(fileHashes(bundle.files), fileHashes(assessment.files))
      ? await done('adopted', null, () => input.store.writeRecord(path, recordFor(bundle)))
      : conflict('not-installed-by-blackbox', null, []);
  }
  const from = assessment.record === null ? null : assessment.record.version;
  if (assessment.changes.length > 0 || assessment.record === null) {
    return conflict('locally-modified', from, assessment.changes);
  }
  if (
    assessment.record.version === bundle.version &&
    sameFiles(assessment.record.files, fileHashes(bundle.files))
  ) {
    return { ...base, outcome: 'unchanged', version: bundle.version, from: null };
  }
  return await done('updated', from, () => input.store.replace(path, input.files, stored));
}

/**
 * Installs the bundle into each selected agent's project skills directory.
 * Anything Blackbox did not write, or that changed since it wrote it, is
 * reported as a conflict and left untouched; the user moves or removes it.
 */
export async function installSkillBundle(input: {
  readonly bundle: SkillBundle;
  readonly agents: readonly SkillAgent[];
  readonly store: SkillStore;
}): Promise<SkillInstallResult> {
  const files = installedFiles(input.bundle);
  const destinations: SkillDestinationResult[] = [];
  for (const destination of skillDestinations(input.bundle.name, input.agents)) {
    destinations.push(
      await installDestination({
        bundle: input.bundle,
        path: destination.path,
        agents: destination.agents,
        files,
        store: input.store,
      }),
    );
  }
  return { destinations };
}

export function installSucceeded(result: SkillInstallResult): boolean {
  return result.destinations.every(({ outcome }) => outcome !== 'conflict' && outcome !== 'failed');
}
