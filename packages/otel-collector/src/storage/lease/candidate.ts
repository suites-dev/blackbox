import { join } from 'node:path';
import type { CurrentLockRecord } from './record.js';

export type LockCandidate =
  | {
      readonly kind: 'claiming-candidate';
      readonly path: string;
      readonly record: CurrentLockRecord;
    }
  | {
      readonly kind: 'owned-candidate';
      readonly path: string;
      readonly record: CurrentLockRecord;
    };

export function encodedToken(token: string): string {
  return Buffer.from(token, 'utf8').toString('hex');
}

export function candidatePath(input: {
  readonly directory: string;
  readonly token: string;
  readonly state: 'claiming' | 'owned';
}): string {
  return join(input.directory, `${encodedToken(input.token)}.${input.state}`);
}

export function temporaryCandidatePath(input: {
  readonly directory: string;
  readonly token: string;
}): string {
  return `${input.directory}.${encodedToken(input.token)}.tmp`;
}

export type CandidateName =
  | {
      readonly kind: 'candidate-name';
      readonly path: string;
      readonly state: 'claiming' | 'owned';
      readonly encodedToken: string;
    }
  | { readonly kind: 'foreign-name' };

export function decodeCandidateName(input: {
  readonly directory: string;
  readonly name: string;
}): CandidateName {
  const match = /^([\da-f]+)\.(claiming|owned)$/u.exec(input.name);
  const token = match === null ? undefined : match.at(1);
  const state = match === null ? undefined : match.at(2);
  return token !== undefined && (state === 'claiming' || state === 'owned')
    ? {
        kind: 'candidate-name',
        path: join(input.directory, input.name),
        state,
        encodedToken: token,
      }
    : { kind: 'foreign-name' };
}
