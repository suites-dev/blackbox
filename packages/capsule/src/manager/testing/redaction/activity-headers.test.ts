import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { managerRequest } from '../../../ipc/client.js';
import { capsuleActivityPath, readCapsuleActivities } from '../../../records.js';
import { createRedactionContext, redactActivity } from '../../../reporting/redaction.js';
import { requestFixture } from '../request.fixture.js';

const stdout =
  'HTTP/1.1 200 OK\r\nsEt-CoOkIe: id=fixture-first; second=fixture-second\r\n\r\nsafe body';
const stderr =
  'x.private: fixture-one, fixture-two\r\nAuthorization: Basic fixture-basic\r\npublic: visible\r\nXxPrivate: harmless\r\nBearer fixture-bearer\r\n{"x.Private":"fixture-json"}';
const argvHeaders = [
  'Cookie: sid=fixture-request; other=fixture-other',
  'X.Private: fixture-catalog',
];
const hidden = [
  'fixture-first',
  'fixture-second',
  'fixture-one',
  'fixture-two',
  'fixture-basic',
  'fixture-request',
  'fixture-other',
  'fixture-catalog',
  'fixture-bearer',
  'fixture-json',
];

async function installDriver(fixture: Awaited<ReturnType<typeof requestFixture>>): Promise<void> {
  await writeFile(
    join(fixture.projectDirectory, 'http.mjs'),
    `export default {
  kind: 'project-driver', name: 'http', prepare(request) {
    return { kind: 'prepared-command', argv: [request.command.argv[0], '--no-warnings', ...request.command.argv.slice(1)],
      environment: {}, propagation: { kind: 'context-not-supported', boundary: 'shared-state', resource: 'test' },
      redaction: { kind: 'driver-redaction', requestArgv: {kind:'none'}, preparedArgv: {kind:'none'}, environment: {kind:'none'} } };
  } };`,
  );
  Object.assign(fixture.manager.drivers, {
    http: {
      id: 'http',
      kind: 'project-driver',
      runtime: 'node',
      ref: 'http.mjs',
      target: {
        kind: 'participant',
        participantId: 'api',
        service: 'api',
        protocol: 'http',
        containerPort: 3000,
      },
      execution: { kind: 'host' },
      propagation: { kind: 'shared-state-propagation-unsupported', resource: 'test' },
    },
  });
  fixture.endpoints.set('driver-http', {
    name: 'driver-http',
    service: 'api',
    containerPort: 3000,
    host: '127.0.0.1',
    port: 4567,
  });
}

it.each(['host', 'driver'] as const)(
  'redacts the %s admission and completed file while preserving live output',
  async (kind) => {
    const fixture = await requestFixture(() => Promise.resolve(), {}, ['X.Private']);
    const child = join(fixture.projectDirectory, 'child.mjs');
    const release = join(fixture.projectDirectory, 'continue');
    const argv = [process.execPath, child, release, ...argvHeaders] as const;
    await writeFile(
      child,
      `import { existsSync } from 'node:fs';
    while (!existsSync(process.argv[2])) await new Promise(r => setTimeout(r, 5));
    process.stdout.write(${JSON.stringify(stdout)});
    process.stderr.write(${JSON.stringify(stderr)});`,
    );
    await installDriver(fixture);
    const response = managerRequest({
      socketPath: fixture.socketPath,
      request: {
        kind: 'exec-request',
        requestId: 'headers',
        name: { kind: 'omitted' },
        purpose: 'stimulus',
        target:
          kind === 'host'
            ? { kind, argv }
            : { kind, argv, driverId: 'http', untraced: { kind: 'refuse' } },
      },
    });
    try {
      await expect
        .poll(async () => (await readCapsuleActivities(fixture)).map((activity) => activity.kind))
        .toEqual(['running']);
      const admission = await readFile(capsuleActivityPath(fixture), 'utf8');
      for (const value of hidden) {
        expect(admission).not.toContain(value);
      }
      await writeFile(release, '');
      const live = { kind: 'exited', exitCode: 0, stdout, stderr };
      await expect(response).resolves.toMatchObject({
        kind: 'exec-response',
        outcome: kind === 'host' ? live : { kind: 'driver-completed', process: live },
      });
      const bytes = await readFile(capsuleActivityPath(fixture), 'utf8');
      for (const value of hidden) {
        expect(bytes).not.toContain(value);
      }
      const masked = ['Cookie: [REDACTED]', 'X.Private: [REDACTED]'];
      const retained = {
        kind: 'exited',
        exitCode: 0,
        stdout: 'HTTP/1.1 200 OK\r\nsEt-CoOkIe: [REDACTED]\r\n\r\nsafe body',
        stderr:
          'x.private: [REDACTED]\r\nAuthorization: [REDACTED]\r\npublic: visible\r\nXxPrivate: harmless\r\nBearer [REDACTED]\r\n{"x.Private":"[REDACTED]"}',
        argv: [
          process.execPath,
          ...(kind === 'driver' ? ['--no-warnings'] : []),
          child,
          release,
          ...masked,
        ],
        retention: { stdout: { kind: 'complete', originalBytes: Buffer.byteLength(stdout) } },
      };
      expect(await readCapsuleActivities(fixture)).toMatchObject([
        {
          kind: 'completed',
          argv: [process.execPath, child, release, ...masked],
          outcome: kind === 'host' ? retained : { kind: 'driver-completed', process: retained },
        },
      ]);
    } finally {
      await writeFile(release, '');
      try {
        await response;
      } finally {
        await fixture.close();
      }
    }
  },
);

it('retains output masking provenance through disk and report projection without changing the live stream', async () => {
  const fixture = await requestFixture(() => Promise.resolve());
  const child = join(fixture.projectDirectory, 'structured.mjs');
  const structured = JSON.stringify({ message: 'Cookie: id=fixture-cookie; other=fixture-other', status: 200, body: 'visible' });
  const raw = 'token=fixture-assignment\n' + structured;
  try {
    await writeFile(child, `process.stdout.write(${JSON.stringify(raw)});process.stderr.write('unchanged');`);
    await expect(managerRequest({
      socketPath: fixture.socketPath,
      request: { kind: 'exec-request', requestId: 'structured', purpose: 'stimulus', name: { kind: 'omitted' },
        target: { kind: 'host', argv: [process.execPath, child] } },
    })).resolves.toMatchObject({ outcome: { stdout: raw } });
    const [activity] = await readCapsuleActivities(fixture);
    expect(activity).toMatchObject({ outcome: { retention: {
      stdout: { redactions: ['sensitive-output', 'sensitive-header'] }, stderr: { kind: 'complete' },
    } } });
    const context = createRedactionContext();
    const report = redactActivity(activity, 0, context);
    expect(report).toMatchObject({ outcome: {
      stdout: 'token=[REDACTED]\n' + JSON.stringify({ message: 'Cookie: [REDACTED]', status: 200, body: 'visible' }),
      stderr: 'unchanged', retention: { stdout: { originalBytes: Buffer.byteLength(raw) } },
    } });
    expect(context.entries.filter(({ location }) => location === 'activities[0].outcome.stdout')
      .map(({ kind }) => kind).sort()).toEqual(['sensitive-header', 'sensitive-output']);
    expect(context.entries.filter(({ location }) => location === 'activities[0].outcome.stderr')).toEqual([]);
  } finally {
    await fixture.close();
  }
});

it('masks a truncated header tail whose field name fell in the omitted middle', async () => {
  const fixture = await requestFixture(() => Promise.resolve());
  const child = join(fixture.projectDirectory, 'truncate.mjs');
  try {
    await writeFile(
      child,
      `const edge = 524288;
      const tail = 'fixture-fragment\\r\\n continued-fixture\\r\\npublic tail\\n';
      process.stdout.write('safe head\\n'.padEnd(edge, 'a') + '\\nCookie: sid=missing-middle' + tail.padEnd(edge, 'z'));`,
    );
    const response = await managerRequest({
      socketPath: fixture.socketPath,
      request: {
        kind: 'exec-request',
        requestId: 'truncation',
        name: { kind: 'omitted' },
        purpose: 'stimulus',
        target: { kind: 'host', argv: [process.execPath, child] },
      },
    });
    expect(response).toMatchObject({
      kind: 'exec-response',
      outcome: { stdout: expect.stringContaining('fixture-fragment') },
    });
    const [activity] = await readCapsuleActivities(fixture);
    expect(activity).toMatchObject({
      kind: 'completed',
      outcome: {
        kind: 'exited',
        stdout: expect.stringContaining('[REDACTED]\r\npublic tail\n'),
        retention: { stdout: { kind: 'truncated', retainedBytes: 1_048_576 } },
      },
    });
    const bytes = await readFile(capsuleActivityPath(fixture), 'utf8');
    expect(bytes).toContain('safe head');
    expect(bytes).not.toContain('fixture-fragment');
    expect(bytes).not.toContain('continued-fixture');
  } finally {
    await fixture.close();
  }
});
