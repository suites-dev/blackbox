import { describe, expect, it } from 'vitest';

import type { CapsuleExecutionOutcome } from '../../types.js';
import { redactOutcomeArgv } from '../redaction.js';

const MASK = '[REDACTED]';
const SECRET = 'run-json-secret-0123456789';

const retention = {
  stdout: { kind: 'complete', originalBytes: 0 },
  stderr: { kind: 'complete', originalBytes: 0 },
} as const;

type Exited = Extract<CapsuleExecutionOutcome, { kind: 'exited' }>;
type DriverCompleted = Extract<CapsuleExecutionOutcome, { kind: 'driver-completed' }>;
type Refused = Extract<CapsuleExecutionOutcome, { kind: 'driver-propagation-refused' }>;

function hostExited(argv: readonly string[]): Exited {
  return {
    kind: 'exited',
    argv,
    location: { kind: 'host' },
    exitCode: 0,
    stdout: `out ${SECRET}\n`,
    stderr: '',
    retention,
  } satisfies Exited;
}

function driverCompleted(argv: readonly string[], positions: readonly number[]): DriverCompleted {
  return {
    kind: 'driver-completed',
    driver: {
      id: 'public-api',
      execution: { kind: 'host' },
      target: {
        kind: 'participant',
        participantId: 'public-api',
        service: 'public-api',
        protocol: 'http',
        containerPort: 3000,
      },
    },
    propagation: {
      schemaVersion: 1,
      kind: 'telemetry-propagation-v1',
      expectation: { kind: 'w3c-trace-context-propagation', carrier: 'http-headers' },
      outcome: { kind: 'context-injected', format: 'w3c-trace-context', carrier: 'http-headers' },
    },
    redaction: {
      kind: 'driver-redaction',
      requestArgv: { kind: 'none' },
      preparedArgv: positions.length === 0 ? { kind: 'none' } : { kind: 'positions', positions },
      environment: { kind: 'none' },
    },
    process: hostExited(argv),
  } satisfies DriverCompleted;
}

function argvOf(outcome: CapsuleExecutionOutcome): readonly string[] {
  if (outcome.kind === 'driver-completed') {
    return outcome.process.argv;
  }
  if ('argv' in outcome) {
    return outcome.argv;
  }
  throw new Error(`${outcome.kind} carries no argv`);
}

/** [name, credential arguments, as printed]. */
const CASES = [
  [
    'a Bearer header value',
    ['-H', `Authorization: Bearer ${SECRET}`],
    ['-H', `Authorization: ${MASK}`],
  ],
  ['a Basic credential', [`Basic ${SECRET}`], [`Basic ${MASK}`]],
  ['a Cookie header', ['--header', `Cookie: session=${SECRET}`], ['--header', `Cookie: ${MASK}`]],
  ['an X-Api-Key header', [`X-Api-Key: ${SECRET}`], [`X-Api-Key: ${MASK}`]],
  [
    'URL user information',
    [`https://alice:${SECRET}@api.example.test/v1`],
    [`https://${MASK}@api.example.test/v1`],
  ],
  [
    'a secret query parameter',
    [`https://api.example.test/v1?token=${SECRET}&page=2`],
    // As in the report: the assignment rule also takes what follows the secret.
    [`https://api.example.test/v1?token=${MASK}`],
  ],
  ['a sensitive flag value', ['--password', SECRET], ['--password', MASK]],
  ['curl -u user:password', ['-u', `alice:${SECRET}`], ['-u', MASK]],
  ['curl --user user:password', ['--user', `alice:${SECRET}`], ['--user', MASK]],
  ['curl --user=user:password', [`--user=alice:${SECRET}`], [`--user=${MASK}`]],
  ['curl -uuser:password', [`-ualice:${SECRET}`], [`-u${MASK}`]],
  ['curl --proxy-user user:password', ['--proxy-user', `alice:${SECRET}`], ['--proxy-user', MASK]],
  ['curl -U user:password', ['-U', `alice:${SECRET}`], ['-U', MASK]],
  ['curl --oauth2-bearer', ['--oauth2-bearer', SECRET], ['--oauth2-bearer', MASK]],
  ['curl --oauth2-bearer=', [`--oauth2-bearer=${SECRET}`], [`--oauth2-bearer=${MASK}`]],
  [
    'curl --pass',
    ['--key', 'client.key', '--pass', SECRET],
    ['--key', 'client.key', '--pass', MASK],
  ],
  ['curl --proxy-pass', ['--proxy-pass', SECRET], ['--proxy-pass', MASK]],
  [
    'curl --cert file:password',
    ['--cert', `client.pem:${SECRET}`],
    ['--cert', `client.pem:${MASK}`],
  ],
  ['curl --cert=file:password', [`--cert=client.pem:${SECRET}`], [`--cert=client.pem:${MASK}`]],
  [
    'URL user information with an empty user name',
    [`https://:${SECRET}@api.example.test/v1`],
    [`https://${MASK}@api.example.test/v1`],
  ],
  [
    'URL user information and a secret query parameter together',
    [`https://alice:${SECRET}@api.example.test/x?token=${SECRET}`],
    [`https://${MASK}@api.example.test/x?token=${MASK}`],
  ],
] satisfies readonly (readonly [string, readonly string[], readonly string[]])[];

describe('redactOutcomeArgv', () => {
  it.each(CASES)(
    'redacts %s and keeps argv[0] and harmless arguments byte for byte',
    (_name, input, expected) => {
      const harmless = ['-fsS', '-X', 'POST', '/fixture/reset', '{"profile":"fresh"}'];
      const redacted = argvOf(redactOutcomeArgv(hostExited(['curl', ...harmless, ...input])));
      expect(redacted).toEqual(['curl', ...harmless, ...expected]);
      expect(redacted.join(' ')).not.toContain(SECRET);
    },
  );

  it('redacts the positions a driver declared, in the prepared argv', () => {
    const argv = ['curl', '--header', 'traceparent: 00-a-b-01', '--data', SECRET, '/orders'];
    const redacted = argvOf(redactOutcomeArgv(driverCompleted(argv, [4])));
    expect(redacted).toEqual([
      'curl',
      '--header',
      'traceparent: 00-a-b-01',
      '--data',
      MASK,
      '/orders',
    ]);
  });

  it.each([
    ['python3', '-u', 'worker.py'],
    ['psql', '-U', 'fixture', '--dbname', 'subscriptions'],
    ['curl', '-u', 'alice', '/prompted-password'],
    ['curl', '--cert', 'client.pem', '/x'],
  ])('leaves a value that is not a credential untouched: %s', (...argv) => {
    expect(argvOf(redactOutcomeArgv(hostExited(argv)))).toEqual(argv);
  });

  it('leaves flags that only start with -u untouched', () => {
    const argv = ['go', 'test', '-update', '-u', `alice:${SECRET}`, '-run', 'TestX'];
    expect(argvOf(redactOutcomeArgv(hostExited(argv)))).toEqual([
      'go',
      'test',
      '-update',
      '-u',
      MASK,
      '-run',
      'TestX',
    ]);
  });

  it('keeps argv[0] even when it would match a rule', () => {
    const argv = [`TOKEN=${SECRET}`, '--version'];
    expect(argvOf(redactOutcomeArgv(hostExited(argv)))[0]).toBe(argv[0]);
  });

  it('changes nothing but argv: the field keeps its place and the child output stays as captured', () => {
    const outcome = hostExited(['curl', '-H', `Authorization: Bearer ${SECRET}`]);
    const redacted = redactOutcomeArgv(outcome);
    expect(Object.keys(redacted)).toEqual(Object.keys(outcome));
    expect({ ...redacted, argv: outcome.argv }).toEqual(outcome);
    // The input is never mutated (the persisted record is not touched).
    expect(outcome.argv[2]).toContain(SECRET);
  });

  it('leaves outcomes without argv unchanged', () => {
    const refused = {
      kind: 'driver-propagation-refused',
      driverId: 'public-api',
      propagation: {
        schemaVersion: 1,
        kind: 'telemetry-propagation-v1',
        expectation: { kind: 'w3c-trace-context-propagation', carrier: 'http-headers' },
        outcome: { kind: 'context-not-injected', reason: 'driver-declared-none' },
      },
    } satisfies Refused;
    expect(redactOutcomeArgv(refused)).toBe(refused);
  });
});
