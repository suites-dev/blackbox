import type { DriverArgvRedaction } from '@suites/blackbox-driver';

import type { CapsuleReportRedaction } from '../types.js';

const MASK = '[REDACTED]';
const sensitiveName =
  /(?:authorization|proxy-authorization|cookie|set-cookie|token|secret|password|passwd|api[-_]?key)/iu;
const header = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)\s*:/iu;
const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u;
const socketPath = /(?:\/[^\s"']+)?\.blackbox\/(?:s|tmp)\/[^\s"']+\.sock/gu;
const windowsPipePath = /\\\\\.\\pipe\\bb-[^\s"']+/gu;
/** Flags whose value is always a secret (curl's OAuth token and key pass phrases). */
const secretValueFlags = new Set(['--oauth2-bearer', '--pass', '--proxy-pass']);
/**
 * Flags whose value is a credential only when it is `user:password`. Other
 * tools use `-u`/`-U` without a value or with a plain name (`python3 -u`,
 * `psql -U`), so a value without `:` is left alone.
 */
const userPasswordFlags = new Set(['-u', '--user', '-U', '--proxy-user']);
/** Flags whose value is `file[:password]` (curl client certificates). */
const certificateFlags = new Set(['--cert', '--proxy-cert']);
// `--user=alice:pw` or `-ualice:pw`; never `-update` or `--user=alice`.
const attachedUserPassword = /^(--user=|--proxy-user=|-[uU])([^\s:]*:.*)$/u;
const attachedCertificate = /^(--cert=|--proxy-cert=)([^:]+:)(.+)$/u;

/** How much of the argument after a flag is a secret. */
type FollowingValue = 'whole' | 'after-colon';

function followingValue(flag: string, next: string | undefined): FollowingValue | null {
  if (secretValueFlags.has(flag)) {
    return 'whole';
  }
  if (next === undefined || !next.includes(':')) {
    return null;
  }
  if (userPasswordFlags.has(flag)) {
    return 'whole';
  }
  return certificateFlags.has(flag) ? 'after-colon' : null;
}

/** A credential flag with its value attached, redacted; null when it is not one. */
function redactAttachedFlag(argument: string): string | null {
  // `--oauth2-bearer=token` needs nothing here: every `name=value` is redacted below.
  const secret = attachedUserPassword.exec(argument);
  if (secret !== null) {
    return `${secret[1]}${MASK}`;
  }
  const certificate = attachedCertificate.exec(argument);
  return certificate === null ? null : `${certificate[1]}${certificate[2]}${MASK}`;
}

export interface RedactionContext {
  readonly entries: CapsuleReportRedaction[];
}

function note(
  context: RedactionContext,
  kind: CapsuleReportRedaction['kind'],
  location: string,
): void {
  context.entries.push({ kind, location });
}

export function redactText(input: string, location: string, context: RedactionContext): string {
  // `scheme://user:password@host`: the user information is a credential.
  let value = input.replace(
    /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#@:]*:[^\s/?#@]*@/giu,
    (_match, scheme: string) => {
      note(context, 'authorization-credential', location);
      return `${scheme}${MASK}@`;
    },
  );
  value = value.replace(/\b(Bearer|Basic)\s+[^\s,"'}]+/giu, (_match, scheme: string) => {
    note(context, 'authorization-credential', location);
    return `${scheme} ${MASK}`;
  });
  value = value.replace(socketPath, () => {
    note(context, 'private-ipc-path', location);
    return MASK;
  });
  value = value.replace(windowsPipePath, () => {
    note(context, 'private-ipc-path', location);
    return MASK;
  });
  value = value.replace(
    /\b(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)\s*:\s*[^\r\n,;}]+/giu,
    (match: string) => {
      note(context, 'sensitive-header', location);
      return `${match.slice(0, match.indexOf(':') + 1)} ${MASK}`;
    },
  );
  value = value.replace(
    /("(?:authorization|token|secret|password|passwd|apiKey|api_key|cookie)"\s*:\s*")[^"]*(")/giu,
    (_match, prefix: string, suffix: string) => {
      note(context, 'sensitive-output', location);
      return `${prefix}${MASK}${suffix}`;
    },
  );
  value = value.replace(
    /([?&](?:token|secret|password|passwd|api[-_]?key|authorization)=)[^&#\s]+/giu,
    (_match, prefix: string) => {
      note(context, 'sensitive-output', location);
      return `${prefix}${MASK}`;
    },
  );
  value = value.replace(/\b([A-Za-z_][A-Za-z0-9_]*=)[^\s,;]+/gu, (_match, prefix: string) => {
    note(context, 'environment-value', location);
    return `${prefix}${MASK}`;
  });
  return value;
}

function redactArgument(argument: string, location: string, context: RedactionContext): string {
  const env = assignment.exec(argument);
  if (env !== null) {
    note(context, 'environment-value', location);
    return `${env[1]}=${MASK}`;
  }
  if (header.test(argument)) {
    note(context, 'sensitive-header', location);
    return `${argument.slice(0, argument.indexOf(':') + 1)} ${MASK}`;
  }
  const equals = argument.indexOf('=');
  if (equals > 0 && sensitiveName.test(argument.slice(0, equals))) {
    note(context, 'sensitive-argument', location);
    // What stays before the value can itself carry a credential (a URL's user information).
    return `${redactText(argument.slice(0, equals + 1), location, context)}${MASK}`;
  }
  return redactText(argument, location, context);
}

export function redactArgv(input: {
  readonly argv: readonly string[];
  readonly location: string;
  readonly context: RedactionContext;
  readonly explicit: DriverArgvRedaction;
}): readonly string[] {
  const positions = new Set(input.explicit.kind === 'positions' ? input.explicit.positions : []);
  let pending: FollowingValue | null = null;
  return input.argv.map((argument, index) => {
    const itemLocation = `${input.location}[${String(index)}]`;
    const following = pending;
    pending = null;
    if (positions.has(index) || following === 'whole') {
      note(input.context, 'sensitive-argument', itemLocation);
      return MASK;
    }
    if (following === 'after-colon') {
      note(input.context, 'sensitive-argument', itemLocation);
      return `${argument.slice(0, argument.indexOf(':') + 1)}${MASK}`;
    }
    if (
      (argument === '--env' || argument === '--environment' || argument === '-e') &&
      !argument.includes('=')
    ) {
      pending = 'whole';
      return argument;
    }
    if (argument.startsWith('--') && sensitiveName.test(argument) && !argument.includes('=')) {
      pending = 'whole';
      return argument;
    }
    // `-u user:password`, `--oauth2-bearer token`, `--cert file:password`.
    pending = followingValue(argument, input.argv[index + 1]);
    if (pending !== null) {
      return argument;
    }
    const attached = redactAttachedFlag(argument);
    if (attached !== null) {
      note(input.context, 'sensitive-argument', itemLocation);
      return attached;
    }
    return redactArgument(argument, itemLocation, input.context);
  });
}

export function createRedactionContext(): RedactionContext {
  return { entries: [] };
}
