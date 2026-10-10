import { PassThrough, Writable } from 'node:stream';

import { expect, it } from 'vitest';

import { defineDriver } from '../../authoring/define-driver.js';
import type { DriverPrepareResponse } from '../../model/preparation.js';
import { driverPreparation } from '../../testing/preparation.fixture.js';
import { driverPrepareRequest } from '../../testing/request.fixture.js';
import { runNodeDriverProcess } from './driver-process.js';

function outputWriter(chunks: string[]): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
}

async function run(
  definition: unknown,
  requestJson = JSON.stringify(driverPrepareRequest()),
): Promise<DriverPrepareResponse> {
  const input = new PassThrough();
  const chunks: string[] = [];
  input.end(requestJson);
  await runNodeDriverProcess({ definition, input, output: outputWriter(chunks) });
  return JSON.parse(chunks.join('')) as DriverPrepareResponse;
}

it('writes one successful protocol response', async () => {
  const definition = defineDriver({
    kind: 'project-driver',
    name: 'http-driver',
    prepare: () => driverPreparation(),
  });
  await expect(run(definition)).resolves.toMatchObject({ kind: 'driver-prepare-succeeded' });
});

it('writes a typed failure when the default export is not a driver', async () => {
  await expect(run({ kind: 'wrong' })).resolves.toMatchObject({
    kind: 'driver-prepare-failed',
    driver: { kind: 'unavailable' },
  });
});

it('keeps invalid requests and authored exceptions inside the typed protocol', async () => {
  const definition = defineDriver({
    kind: 'project-driver',
    name: 'http-driver',
    prepare: () => Promise.reject(new Error('authored failure')),
  });
  await expect(run(definition, '{}')).resolves.toMatchObject({
    kind: 'driver-prepare-failed',
    driver: { kind: 'available', name: 'http-driver' },
    error: { name: 'DriverProtocolError' },
  });
  await expect(run(definition)).resolves.toEqual({
    kind: 'driver-prepare-failed',
    protocolVersion: 1,
    driver: { kind: 'available', name: 'http-driver' },
    error: { name: 'Error', message: 'authored failure' },
  });
});

it('reports the served catalog key for a driver without a name', async () => {
  const definition = defineDriver({
    kind: 'project-driver',
    prepare: () => Promise.reject(new Error('authored failure')),
  });
  await expect(run(definition)).resolves.toMatchObject({
    kind: 'driver-prepare-failed',
    driver: { kind: 'available', name: 'http-driver' },
    error: { message: 'authored failure' },
  });
  await expect(run(definition, '{}')).resolves.toMatchObject({
    kind: 'driver-prepare-failed',
    driver: { kind: 'unavailable' },
  });
  await expect(
    run({ kind: 'project-driver', prepare: () => driverPreparation() }),
  ).resolves.toMatchObject({ kind: 'driver-prepare-succeeded', driver: { name: 'http-driver' } });
});

it('refuses a default export whose name is present but not a driver name', async () => {
  await expect(
    run({ kind: 'project-driver', name: undefined, prepare: () => driverPreparation() }),
  ).resolves.toMatchObject({ kind: 'driver-prepare-failed', driver: { kind: 'unavailable' } });
});
