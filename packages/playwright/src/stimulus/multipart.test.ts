import { once } from 'node:events';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { APIRequestContext, APIResponse } from '@playwright/test';
import { expect, it } from 'vitest';

import { AttemptStimuli } from '../activities/execution/attempt-stimuli.js';
import { compareSides } from '../compare/compare.js';
import { sideFixture } from '../compare/testing/compare.fixture.js';
import { stimulusSection } from '../reporting/capture/envelope.js';
import { sandboxRequest } from '../request/sandbox-request.js';
import { summarizeRequest } from './summary.js';

type Multipart = NonNullable<NonNullable<Parameters<APIRequestContext['post']>[1]>['multipart']>;

async function send(file: ReadStream) {
  const stimuli = new AttemptStimuli({ sessionId: 's', executionId: 'e' });
  const calls: unknown[] = [];
  const target = {
    post: <T>(_url: string, options?: Parameters<APIRequestContext['post']>[1]) => {
      calls.push(options);
      expect(file.readableFlowing).toBeNull();
      expect(file.readableDidRead).toBe(false);
      expect(file.destroyed).toBe(false);
      expect(file.bytesRead).toBe(0);
      return Promise.resolve({} as APIResponse<T>);
    },
  } as APIRequestContext;
  const request = sandboxRequest(
    target,
    () => undefined,
    (entry, opaque) => {
      stimuli.record(entry, 'http://entrypoint.test', opaque);
    },
  );
  const options = { multipart: { title: 'same', file } };
  await stimuli.run('When', () => request.post('/upload', options));
  expect(calls).toHaveLength(1);
  expect(calls[0]).toBe(options);
  return stimulusSection(stimuli.recorded());
}

async function close(stream: ReadStream): Promise<void> {
  // The test owns stream cleanup; summary and dispatch must leave it alone.
  const closed = once(stream, 'close');
  stream.destroy();
  await closed;
}

it('keeps fresh streams of changed bytes at the same path unestablished and dispatches them untouched', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-multipart-'));
  const path = join(directory, 'upload.txt');
  try {
    await writeFile(path, 'alice');
    const first = createReadStream(path);
    const reference = await send(first).finally(() => close(first));
    await writeFile(path, 'bobby');
    const second = createReadStream(path);
    const head = await send(second).finally(() => close(second));
    const delta = compareSides(
      sideFixture({ stimulus: reference }),
      sideFixture({ stimulus: head }),
    );
    expect(delta.outcome).toBe('inconclusive');
    expect(delta.unresolved.map(({ kind }) => kind)).toContain('stimulus-unestablished');
    for (const section of [reference, head]) {
      expect(section).toMatchObject({ state: 'recorded', opaqueRequests: 1, fingerprint: null });
      expect(section.activities[0].requests).toEqual([]);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('keeps supported multipart scalars and file descriptors content-aware', () => {
  const summary = (multipart: Multipart) =>
    summarizeRequest(
      {
        method: 'POST',
        url: '/upload',
        options: { multipart },
      },
      null,
    );
  const body = {
    title: 'same',
    active: true,
    n: 1,
    file: {
      name: 'same.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('alice'),
    },
  };
  const original = summary(body)!;
  expect(original.body).toMatch(/^sha256:/);
  expect(summary({ ...body, file: { ...body.file, buffer: Buffer.from('bobby') } })!.body).not.toBe(
    original.body,
  );
  expect(summary({ ...body, title: 'changed' })!.body).not.toBe(original.body);
  expect(summary({ ...body, file: { ...body.file, name: 'other.txt' } })!.body).not.toBe(
    original.body,
  );
  expect(
    summary({ ...body, file: { ...body.file, mimeType: 'application/octet-stream' } })!.body,
  ).not.toBe(original.body);
  expect(summary({ ...body, file: { ...body.file, buffer: Buffer.from('alice') } })!.body).toBe(
    original.body,
  );
});

it('captures finite multipart numbers but keeps non-finite inputs unestablished', () => {
  const summary = (count: number) =>
    summarizeRequest(
      {
        method: 'POST',
        url: '/upload',
        options: { multipart: { count } },
      },
      null,
    );
  expect(summary(1.5)!.body).toMatch(/^sha256:/);
  expect(summary(1.5)!.body).not.toBe(summary(2.5)!.body);
  for (const count of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    expect(summary(count)).toBeNull();
  }
});
