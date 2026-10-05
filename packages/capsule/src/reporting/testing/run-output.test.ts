import { describe, expect, it } from 'vitest';

import type { CapsuleExecutionOutcome } from '../../model/execution/outcome.js';
import { redactOutcomeOutput } from '../redaction/run-output.js';

// Synthetic JWT, joined at runtime so secret scanners don't flag a literal token.
const TOKEN = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJmZHNlIn0', 'c2lnbmF0dXJlLXZhbHVl'].join('.');
const retention = {
  stdout: { kind: 'complete', originalBytes: 120 },
  stderr: { kind: 'complete', originalBytes: 40 },
} as const;

type Exited = Extract<CapsuleExecutionOutcome, { kind: 'exited' }>;

const exited = {
  kind: 'exited',
  argv: ['curl', '-s', '/api/v1/users/login'],
  location: { kind: 'host' },
  exitCode: 0,
  stdout: `{"status":1,"msg":"login success","data":{"token":"${TOKEN}"}}\nhttp_code=200`,
  stderr: `Authorization: Bearer ${TOKEN}`,
  retention,
} satisfies Exited;

describe('redactOutcomeOutput (capsule run --json)', () => {
  it('redacts response secrets in stdout and stderr and keeps everything else', () => {
    const redacted = redactOutcomeOutput(exited, 'redacted');
    expect(JSON.stringify(redacted)).not.toContain(TOKEN);
    expect(redacted).toEqual({
      ...exited,
      stdout: '{"status":1,"msg":"login success","data":{"token":"[REDACTED]"}}\nhttp_code=200',
      stderr: 'Authorization: [REDACTED]',
    });
  });

  it('redacts the process of a driver run', () => {
    const driver = {
      kind: 'driver-completed',
      driver: {
        id: 'auth',
        execution: { kind: 'host' },
        target: {
          kind: 'participant',
          participantId: 'auth',
          service: 'auth',
          protocol: 'http',
          containerPort: 12340,
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
        preparedArgv: { kind: 'none' },
        environment: { kind: 'none' },
      },
      process: exited,
    } satisfies CapsuleExecutionOutcome;
    expect(JSON.stringify(redactOutcomeOutput(driver, 'redacted'))).not.toContain(TOKEN);
  });

  it('prints the output as captured with raw, and leaves a process that never ran alone', () => {
    expect(redactOutcomeOutput(exited, 'raw')).toBe(exited);
    const missing = {
      kind: 'executable-not-found',
      argv: ['nope'],
      location: { kind: 'host' },
      remediation: 'Install nope',
    } satisfies CapsuleExecutionOutcome;
    expect(redactOutcomeOutput(missing, 'redacted')).toEqual(missing);
  });
});
