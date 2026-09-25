import type { DriverArgvRedaction } from '@suites/blackbox-driver';

import type { CapsuleReportRedaction } from '../types.js';

const MASK = '[REDACTED]';
const sensitiveName =
  /(?:authorization|proxy-authorization|cookie|set-cookie|token|secret|password|passwd|api[-_]?key)/iu;
const header = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)\s*:/iu;
const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u;
const socketPath = /(?:\/[^\s"']+)?\.blackbox\/(?:s|tmp)\/[^\s"']+\.sock/gu;

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
  let value = input.replace(/\b(Bearer|Basic)\s+[^\s,"'}]+/giu, (_match, scheme: string) => {
    note(context, 'authorization-credential', location);
    return `${scheme} ${MASK}`;
  });
  value = value.replace(socketPath, () => {
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
    return `${argument.slice(0, equals + 1)}${MASK}`;
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
  let redactNext = false;
  return input.argv.map((argument, index) => {
    const itemLocation = `${input.location}[${String(index)}]`;
    if (positions.has(index) || redactNext) {
      redactNext = false;
      note(input.context, 'sensitive-argument', itemLocation);
      return MASK;
    }
    if (
      (argument === '--env' || argument === '--environment' || argument === '-e') &&
      !argument.includes('=')
    ) {
      redactNext = true;
      return argument;
    }
    if (argument.startsWith('--') && sensitiveName.test(argument) && !argument.includes('=')) {
      redactNext = true;
      return argument;
    }
    return redactArgument(argument, itemLocation, input.context);
  });
}

export function createRedactionContext(): RedactionContext {
  return { entries: [] };
}
