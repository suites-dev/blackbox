import { constants } from 'node:os';

/**
 * The one exit-code table for every Blackbox command. Only `run` (and its
 * `capsule exec` alias) passes a child's code through; every other command maps
 * its outcome to one of these values.
 */
export const EXIT_CODES = {
  success: 0,
  /** Kept only by the unchanged catalog validate, driver install and inst install. */
  unchangedCommandFailure: 1,
  usage: 2,
  reserved: 3,
  blackboxFailure: 125,
  /** The host refused to execute the command's file (EACCES or EPERM). */
  notExecutable: 126,
  executableNotFound: 127,
  signalBase: 128,
} as const;

/**
 * How a command reports a usage or resolution error. `run` must keep 1..124
 * (and 126/127) unambiguous for the child, so its own usage errors become 125.
 */
export type UsageExit = typeof EXIT_CODES.usage | typeof EXIT_CODES.blackboxFailure;

export function signalExitCode(signal: NodeJS.Signals): number {
  const number = (constants.signals as Readonly<Record<string, number>>)[signal];
  return EXIT_CODES.signalBase + (typeof number === 'number' ? number : 0);
}
