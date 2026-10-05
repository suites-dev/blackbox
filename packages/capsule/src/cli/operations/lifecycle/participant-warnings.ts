import { checkCapsuleParticipants, type CapsuleParticipantExit } from '@suites/blackbox-capsule';

/** `participant auth-mongo (ts-auth-mongo) exited with code 0`, or why it is gone. */
export function participantExitText(exit: Omit<CapsuleParticipantExit, 'containerId'>): string {
  const name = `participant ${exit.participant} (${exit.service})`;
  if (exit.state === 'missing') {
    return `${name} is gone: its container ${exit.containerName} no longer exists`;
  }
  const code = exit.exitCode === null ? '' : ` with code ${String(exit.exitCode)}`;
  return `${name} ${exit.state === 'dead' ? 'is dead' : 'exited'}${code}`;
}

export interface ParticipantWarnings {
  /** Human lines, each starting with `⚠`; empty when every participant runs. */
  readonly lines: readonly string[];
  /** The exited participants, for JSON output. */
  readonly exited: readonly CapsuleParticipantExit[];
}

const NONE = { lines: [], exited: [] } satisfies ParticipantWarnings;

/**
 * Checks a running capsule's participants and records any that exited. A capsule
 * that is not running, or a Docker query that fails, adds no warning: this check
 * never makes a command fail.
 */
export async function participantWarnings(capsule: string): Promise<ParticipantWarnings> {
  const check = await checkCapsuleParticipants({
    projectDirectory: process.cwd(),
    sessionId: capsule,
  });
  if (check.kind !== 'participants-checked' || check.exited.length === 0) {
    return NONE;
  }
  return {
    lines: check.exited.map((exit) => `⚠ ${participantExitText(exit)}`),
    exited: check.exited,
  };
}
