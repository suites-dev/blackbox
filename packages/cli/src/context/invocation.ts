import { cliFailure } from '../cli/failure.js';
import { writeHuman } from '../cli/output.js';
import { readCurrentCapsule } from './current-capsule.js';
import { ProjectIndex } from './project-index.js';
import type { SearchScope } from './resolver.js';

export type CapsuleSource = 'flag' | 'environment' | 'current';

export interface ResolvedCapsule {
  readonly capsule: string;
  readonly source: CapsuleSource;
}

/**
 * Per-invocation capsule context. Explicit context is `--capsule`/`--session`,
 * then BLACKBOX_CAPSULE; the current-capsule file is implicit and never
 * narrows ID search. A bad current-capsule file is reported once and ignored,
 * never deleted or rewritten.
 */
export class InvocationContext {
  readonly projectDirectory: string;
  readonly #environment: string | null;
  #index: Promise<ProjectIndex> | null = null;
  #current: Promise<string | null> | null = null;

  constructor(projectDirectory: string, environment: NodeJS.ProcessEnv = process.env) {
    this.projectDirectory = projectDirectory;
    const value = environment.BLACKBOX_CAPSULE;
    this.#environment = value === undefined || value === '' ? null : value;
  }

  index(): Promise<ProjectIndex> {
    this.#index ??= ProjectIndex.load(this.projectDirectory);
    return this.#index;
  }

  /** `--capsule`/`--session` first, then BLACKBOX_CAPSULE. */
  explicit(flag: string | null): ResolvedCapsule | null {
    if (flag !== null) {
      return { capsule: flag, source: 'flag' };
    }
    return this.#environment === null
      ? null
      : { capsule: this.#environment, source: 'environment' };
  }

  scope(flag: string | null): SearchScope {
    const explicit = this.explicit(flag);
    return explicit === null ? { kind: 'project' } : { kind: 'capsule', capsule: explicit.capsule };
  }

  /** The valid current capsule, or null (warning once when the file is unusable). */
  current(): Promise<string | null> {
    this.#current ??= this.#readCurrent();
    return this.#current;
  }

  /** Explicit context, else the current capsule, else capsule-unresolved. */
  async capsule(flag: string | null): Promise<ResolvedCapsule> {
    const explicit = this.explicit(flag);
    if (explicit !== null) {
      return explicit;
    }
    const current = await this.current();
    if (current === null) {
      throw cliFailure('capsule-unresolved', 'no capsule selected', ['blackbox ls']);
    }
    return { capsule: current, source: 'current' };
  }

  async #readCurrent(): Promise<string | null> {
    const read = await readCurrentCapsule(this.projectDirectory);
    if (read.kind === 'none') {
      return null;
    }
    if (read.kind === 'invalid') {
      warn(read.reason);
      return null;
    }
    const index = await this.index();
    if (index.capsule(read.capsule) === null) {
      warn(`unknown capsule ${read.capsule}`);
      return null;
    }
    return read.capsule;
  }
}

function warn(reason: string): void {
  writeHuman([
    `blackbox: ignoring .blackbox/state/current-capsule (${reason}); pass --capsule or run blackbox use`,
  ]);
}
