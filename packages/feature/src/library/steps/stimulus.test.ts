import { afterEach, describe, expect, it } from 'vitest';

import { json, scenarioAt, table } from '../testing/step-harness.js';
import { useStubSystems } from '../testing/stub-lifecycle.js';

// Requirements (task 2.3, report sections 2.8, 2.9 and 6.2): a setup step
// sends a JSON request and checks its status without recording it; stimulus
// steps send JSON, or a bodyless GET, to the Sandbox entrypoint only, never
// follow redirects, and record every response; concurrent requests are all in
// flight together. Negative controls: spike E's no-row stub, which answers 201
// without persisting the subscription, and the not-ready stub, whose health
// check answers 503.

const SUBSCRIBE = 'the client sends POST "/subscriptions" with JSON:';
const CONCURRENT = 'the client sends these requests concurrently:';
const setup = (status: number) =>
  `the client has sent POST "/subscriptions" with JSON and received ${status}:`;

const system = useStubSystems(afterEach);

describe('the client has sent {word} {string} with JSON and received {int}:', () => {
  const carol = '{"userId": "carol", "paymentMethodId": "pm_carol_primary"}';

  it('sends the doc string as JSON and checks the status without recording a stimulus', async () => {
    const sut = await system('correct');
    const scenario = scenarioAt(sut.url);
    await scenario.step(setup(201), json(carol));
    expect(sut.received).toEqual([
      {
        method: 'POST',
        path: '/subscriptions',
        contentType: 'application/json',
        authorization: null,
        body: carol,
      },
    ]);
    await expect(scenario.step('the response status is 201')).rejects.toThrow(
      'stimulus steps before this step',
    );
  });

  it('tells a persisted setup from a lost one (no-row)', async () => {
    const correct = scenarioAt((await system('correct')).url);
    await correct.step(setup(201), json(carol));
    await correct.step(setup(409), json(carol));
    const noRow = scenarioAt((await system('no-row')).url);
    await noRow.step(setup(201), json(carol));
    await expect(noRow.step(setup(409), json(carol))).rejects.toThrow(
      'setup POST /subscriptions status',
    );
  });
});

describe('the client sends {word} {string} with JSON:', () => {
  it('records the response for the claims that follow', async () => {
    const sut = await system('correct');
    const scenario = scenarioAt(sut.url);
    await scenario.step(
      SUBSCRIBE,
      json('{"userId": "alice", "paymentMethodId": "pm_alice_primary"}'),
    );
    await scenario.step('the response status is 201');
    await expect(scenario.step('the response status is 200')).rejects.toThrow(
      'status of POST /subscriptions',
    );
    expect(sut.received.map((request) => request.contentType)).toEqual(['application/json']);
  });

  it('refuses before sending: a doc string that is not JSON, a non-JSON media type, a GET, another origin', async () => {
    const sut = await system('correct');
    const scenario = scenarioAt(sut.url);
    const body = json('{"userId": "alice"}');
    await expect(scenario.step(SUBSCRIBE, json('{"userId": '))).rejects.toThrow(
      'the doc string is JSON',
    );
    await expect(
      scenario.step(SUBSCRIBE, { kind: 'doc-string', content: '{}', mediaType: 'sql' }),
    ).rejects.toThrow('doc string media type');
    await expect(
      scenario.step('the client sends GET "/subscriptions" with JSON:', body),
    ).rejects.toThrow('HTTP method of a JSON request');
    for (const path of [
      '//evil.example/subscriptions',
      'http://evil.example/subscriptions',
      'subscriptions',
    ]) {
      await expect(
        scenario.step(`the client sends POST "${path}" with JSON:`, body),
        path,
      ).rejects.toThrow('request path (absolute, on the Sandbox entrypoint)');
    }
    expect(sut.received).toEqual([]);
  });
});

describe('the client sends these requests concurrently:', () => {
  const rows = table([
    ['method', 'path', 'json'],
    ['POST', '/subscriptions', '{"userId": "bob", "paymentMethodId": "pm_bob_one"}'],
    ['POST', '/subscriptions', '{"userId": "bob", "paymentMethodId": "pm_bob_two"}'],
  ]);

  it('has every request in flight at once and records all responses', async () => {
    const sut = await system('correct');
    const scenario = scenarioAt(sut.url);
    await scenario.step(CONCURRENT, rows);
    expect(sut.maxInFlight()).toBe(2);
    await scenario.step('the response statuses are "201, 409"');
    await expect(scenario.step('the response status is 201')).rejects.toThrow(
      'responses to the latest stimulus step',
    );
  });

  it('tells one winner from two (no-row)', async () => {
    const scenario = scenarioAt((await system('no-row')).url);
    await scenario.step(CONCURRENT, rows);
    await expect(scenario.step('the response statuses are "201, 409"')).rejects.toThrow(
      'statuses of the latest stimulus step, in any order',
    );
  });

  it('requires the method, path and json columns and at least two requests', async () => {
    const sut = await system('correct');
    const scenario = scenarioAt(sut.url);
    await expect(
      scenario.step(
        CONCURRENT,
        table([
          ['method', 'path', 'body'],
          ['POST', '/subscriptions', '{}'],
        ]),
      ),
    ).rejects.toThrow('data table header row');
    await expect(
      scenario.step(
        CONCURRENT,
        table([
          ['method', 'path', 'json'],
          ['POST', '/subscriptions', '{}'],
        ]),
      ),
    ).rejects.toThrow('requests in a concurrent stimulus');
    expect(sut.received).toEqual([]);
  });
});

describe('the client sends GET {string}', () => {
  const READY = json('{"status": "ready"}');

  it('sends a bodyless, credential-free GET and records it as the latest stimulus, after any setup', async () => {
    const sut = await system('correct');
    const scenario = scenarioAt(sut.url);
    await scenario.step(
      setup(201),
      json('{"userId": "carol", "paymentMethodId": "pm_carol_primary"}'),
    );
    await scenario.step('the client sends GET "/health"');
    await scenario.step('the response status is 200');
    await scenario.step('the response JSON equals:', READY);
    expect(sut.received.at(-1)).toEqual({
      method: 'GET',
      path: '/health',
      contentType: null,
      authorization: null,
      body: '',
    });
  });

  it('tells a ready system from one still starting', async () => {
    const scenario = scenarioAt((await system('not-ready')).url);
    await scenario.step('the client sends GET "/health"');
    await expect(scenario.step('the response status is 200')).rejects.toThrow(
      'status of GET /health',
    );
    await expect(scenario.step('the response JSON equals:', READY)).rejects.toThrow(
      'body of GET /health',
    );
  });

  it('records a redirect instead of following it, and refuses other origins before sending', async () => {
    const sut = await system('correct');
    const scenario = scenarioAt(sut.url);
    await scenario.step('the client sends GET "/fixture/moved"');
    await scenario.step('the response status is 302');
    expect(sut.received.map((request) => request.path)).toEqual(['/fixture/moved']);
    for (const path of ['//evil.example/health', 'http://evil.example/health', 'health']) {
      await expect(scenario.step(`the client sends GET "${path}"`), path).rejects.toThrow(
        'request path (absolute, on the Sandbox entrypoint)',
      );
    }
    expect(sut.received).toHaveLength(1);
  });
});
