import type { APIRequestContext, APIResponse } from '@playwright/test';
import { describe, expect, it } from 'vitest';

import { AttemptStimuli } from '../activities/execution/attempt-stimuli.js';
import { compareSides } from '../compare/compare.js';
import { sideFixture } from '../compare/testing/compare.fixture.js';
import { stimulusSection } from '../reporting/capture/envelope.js';
import { sandboxRequest } from '../request/sandbox-request.js';
import { summarizeRequest } from './summary.js';

function form(value: string, file: boolean): FormData {
  const body = new FormData();
  body.append('user', file ? 'same-user' : value);
  body.append('user', file ? 'same-second-user' : `${value}-second`);
  if (file) {
    body.append('attachment', new File([value], 'same-name.txt', { type: 'text/plain' }));
  }
  return body;
}

async function send(key: 'form' | 'multipart', body: FormData) {
  const stimuli = new AttemptStimuli({ sessionId: 's', executionId: 'e' });
  const calls: { url: string; options: unknown }[] = [];
  const target = {
    post: <T>(url: string, options?: Parameters<APIRequestContext['post']>[1]) => {
      calls.push({ url, options });
      return Promise.resolve({} as APIResponse<T>);
    },
  } as APIRequestContext;
  const request = sandboxRequest(
    target,
    () => ({ url: 'http://127.0.0.1:4000', protocol: 'http' }),
    (entry, opaque) => {
      stimuli.record(entry, 'http://127.0.0.1:4000', opaque);
    },
  );
  const options = { [key]: body };
  await stimuli.run('When', async () => {
    await request.post('/supported', { data: { n: 1 } });
    await request.post('/form', options);
  });
  expect(calls).toHaveLength(2);
  expect(calls[1].url).toBe('http://127.0.0.1:4000/form');
  expect(calls[1].options).toBe(options);
  expect(calls[1].options).toEqual({ [key]: body });
  return stimulusSection(stimuli.recorded());
}

describe.each(['form', 'multipart'] as const)('%s FormData capture', (key) => {
  it.each([false, true])(
    'keeps differing bodies unestablished (files: %s) and sends them intact',
    async (file) => {
      const alice = form('alice', file);
      const bob = form('bob', file);
      const reference = await send(key, alice);
      const head = await send(key, bob);
      const delta = compareSides(
        sideFixture({ stimulus: reference }),
        sideFixture({ stimulus: head }),
      );
      expect(delta.outcome).toBe('inconclusive');
      expect(delta.unresolved.map(({ kind }) => kind)).toContain('stimulus-unestablished');
      for (const stimulus of [reference, head]) {
        expect(stimulus.opaqueRequests).toBe(1);
        expect(stimulus.activities[0].requests).toHaveLength(1);
        expect(stimulus.fingerprint).toBeNull();
        expect(JSON.stringify(stimulus)).not.toContain('alice');
        expect(JSON.stringify(stimulus)).not.toContain('bob');
      }
      for (const body of [alice, bob]) {
        expect(
          summarizeRequest({ method: 'POST', url: '/form', options: { [key]: body } }, null),
        ).toBeNull();
      }
    },
  );

  it('preserves content-aware summaries for supported ordinary bodies', () => {
    const summarize = (value: string) =>
      summarizeRequest(
        {
          method: 'POST',
          url: '/form',
          options: { [key]: { user: value, count: 1 } },
        },
        null,
      );
    const alice = summarize('alice')!;
    const bob = summarize('bob')!;
    expect(alice.body).toMatch(/^sha256:/);
    expect(alice.body).not.toBe(bob.body);
  });
});
