import { afterEach, describe, expect, it } from 'vitest';

import { startAnswerSystem, type AnswerSystem } from '../testing/answer-system.js';
import { json, scenarioAt } from '../testing/step-harness.js';
import { useStubSystems } from '../testing/stub-lifecycle.js';
import { STUB_TOKEN, type StubMode } from '../testing/stub-system.js';

// Requirements (task 2.3, report sections 2.10 and 6.2): response claims judge
// the latest stimulus's responses; state claims read an inspection endpoint
// with a named credential and address members by JSON Pointer. Each claim is
// shown to pass against the correct stub and to fail against spike E's no-row
// stub, which answers 201 without persisting the subscription.

const system = useStubSystems(afterEach);

const SUBSCRIBE = 'the client sends POST "/subscriptions" with JSON:';
const STATE = 'the state at "/fixture/state" as "fixture-control"';
const body = (user: string) => json(`{"userId": "${user}", "paymentMethodId": "pm_${user}_primary"}`);
const row = (user: string, tier: string) =>
  json(`[{"id": "subscription_${user}", "userId": "${user}", "tier": "${tier}", "status": "active"}]`);

/** A scenario against a fresh stub in `mode`, after the given users subscribed as its stimuli. */
async function after(mode: StubMode, ...users: readonly string[]) {
  const scenario = scenarioAt((await system(mode)).url);
  for (const user of users) {
    await scenario.step(SUBSCRIBE, body(user));
  }
  return scenario;
}

describe('response claims', () => {
  it('the response status is {int}: a repeated request is a conflict, unless the row was lost', async () => {
    const repeated = async (mode: StubMode) => {
      const scenario = await after(mode, 'carol', 'carol');
      return scenario.step('the response status is 409');
    };
    await repeated('correct');
    await expect(repeated('no-row')).rejects.toThrow('status of POST /subscriptions');
  });

  it('the response JSON equals: compares the parsed body exactly', async () => {
    const conflict = json('{"outcome": "already-subscribed", "userId": "carol"}');
    await (await after('correct', 'carol', 'carol')).step('the response JSON equals:', conflict);
    await expect((await after('no-row', 'carol', 'carol')).step('the response JSON equals:', conflict)).rejects.toThrow(
      'body of POST /subscriptions',
    );
    const created = await after('correct', 'alice');
    await expect(
      created.step('the response JSON equals:', json('{"userId": "alice", "tier": "pro"}')),
    ).rejects.toThrow('body of POST /subscriptions');
  });

  it('the response statuses are {string}: refuses a list that is not statuses', async () => {
    const scenario = await after('correct', 'alice');
    await scenario.step('the response statuses are "201"');
    await expect(scenario.step('the response statuses are "201 and 409"')).rejects.toThrow(
      'statuses as a comma-separated list',
    );
  });
});

// Benchmark finding F2: train-ticket answers a login with HTTP 200 whether it
// succeeds or not and reports the outcome in the body, so "status 200" holds
// for a wrong password. These bodies are the shapes the benchmark recorded.
const LOGIN_OK =
  '{"status": 1, "msg": "login success", "data": {"userId": "4d2a46c7-71cb-4cf1-b5bb-b68406d9da6f", "username": "fdse_microservice", "token": "test-token"}}';
const LOGIN_REFUSED = '{"status": 0, "msg": "Incorrect username or password.", "data": null}';
const TRIPS =
  '{"status": 1, "msg": "Success", "data": [{"tripId": {"type": "G", "number": "1234"}}, {"tripId": {"type": "G", "number": "1235"}}, {"tripId": {"type": "G", "number": "1236"}}]}';

const answering: AnswerSystem[] = [];
afterEach(async () => {
  await Promise.all(answering.splice(0).map((sut) => sut.close()));
});

/** A scenario whose latest stimulus was answered with HTTP 200 and `body`. */
async function answeredWith(body: string) {
  const sut = await startAnswerSystem({ '/api/v1/users/login': { status: 200, body } });
  answering.push(sut);
  const scenario = scenarioAt(sut.url);
  await scenario.step(
    'the client sends POST "/api/v1/users/login" with JSON:',
    json('{"username": "fdse_microservice", "password": "111111", "verificationCode": ""}'),
  );
  await scenario.step('the response status is 200');
  return scenario;
}

describe('response member claims (benchmark F2)', () => {
  it('the response has {string} equal to: the member at a JSON Pointer, which must exist', async () => {
    const accepted = await answeredWith(LOGIN_OK);
    await accepted.step('the response has "/status" equal to:', json('1'));
    await accepted.step('the response has "/data/username" equal to:', json('"fdse_microservice"'));
    const refused = await answeredWith(LOGIN_REFUSED);
    await expect(refused.step('the response has "/status" equal to:', json('1'))).rejects.toThrow(
      '/status in the body of POST /api/v1/users/login',
    );
    await expect(refused.step('the response has "/data/token" equal to:', json('null'))).rejects.toThrow(
      '/data/token in the body of POST /api/v1/users/login',
    );
    await expect(accepted.step('the response has "status" equal to:', json('1'))).rejects.toThrow('JSON Pointer (RFC 6901)');
  });

  it('the response has {int} item(s) at {string}: the length of an array, which must be there', async () => {
    const trips = await answeredWith(TRIPS);
    await trips.step('the response has 3 items at "/data"');
    await expect(trips.step('the response has 2 items at "/data"')).rejects.toThrow(
      'items of the array at /data in the body of POST /api/v1/users/login',
    );
    await expect(trips.step('the response has 1 item at "/data/0"')).rejects.toThrow('items of the array at /data/0');
    // A missing array is not an empty one.
    const refused = await answeredWith(LOGIN_REFUSED);
    await expect(refused.step('the response has 0 items at "/data"')).rejects.toThrow('items of the array at /data');
  });

  it('the response has a value at {string}: a member other than null, such as a generated token', async () => {
    await (await answeredWith(LOGIN_OK)).step('the response has a value at "/data/token"');
    const refused = await answeredWith(LOGIN_REFUSED);
    await expect(refused.step('the response has a value at "/data/token"')).rejects.toThrow(
      'a value other than null at /data/token in the body of POST /api/v1/users/login',
    );
    await expect(refused.step('the response has a value at "/data"')).rejects.toThrow('a value other than null at /data');
    await refused.step('the response has a value at "/msg"');
  });

  it('judge the one response of the latest stimulus, not another step\'s', async () => {
    const scenario = await after('correct', 'alice');
    await scenario.step('the response has a value at "/subscription/id"');
    await scenario.step(SUBSCRIBE, body('alice'));
    await expect(scenario.step('the response has a value at "/subscription/id"')).rejects.toThrow(
      'a value other than null at /subscription/id in the body of POST /subscriptions',
    );
  });
});

describe('state claims', () => {
  it('the state at {string} as {string} equals: the whole document', async () => {
    const empty = json('{"subscriptions": [], "orders": []}');
    await (await after('correct')).step(`${STATE} equals:`, empty);
    const dora = json(
      '{"subscriptions": [{"id": "subscription_dora", "userId": "dora", "tier": "basic", "status": "active"}], "orders": []}',
    );
    await (await after('correct', 'dora')).step(`${STATE} equals:`, dora);
    await expect((await after('no-row', 'dora')).step(`${STATE} equals:`, dora)).rejects.toThrow(
      'the state at /fixture/state as "fixture-control"',
    );
  });

  it('has {string} equal to: the member at a JSON Pointer, which must exist', async () => {
    await (await after('correct', 'alice')).step(`${STATE} has "/subscriptions" equal to:`, row('alice', 'pro'));
    await (await after('correct', 'alice')).step(`${STATE} has "/subscriptions/0/status" equal to:`, json('"active"'));
    await expect(
      (await after('no-row', 'alice')).step(`${STATE} has "/subscriptions" equal to:`, row('alice', 'pro')),
    ).rejects.toThrow('/subscriptions in the state at /fixture/state');
    const scenario = await after('correct');
    await expect(scenario.step(`${STATE} has "/missing" equal to:`, json('null'))).rejects.toThrow(
      '/missing in the state at /fixture/state',
    );
    await expect(scenario.step(`${STATE} has "subscriptions" equal to:`, json('[]'))).rejects.toThrow(
      'JSON Pointer (RFC 6901)',
    );
  });

  it('has {int} item(s) at {string}: the length of an array, which must be there', async () => {
    await (await after('correct', 'alice')).step(`${STATE} has 1 item at "/subscriptions"`);
    await expect((await after('no-row', 'alice')).step(`${STATE} has 1 item at "/subscriptions"`)).rejects.toThrow(
      'items of the array at /subscriptions',
    );
    const scenario = await after('correct', 'alice');
    await expect(scenario.step(`${STATE} has 1 item at "/subscriptions/0"`)).rejects.toThrow(
      'items of the array at /subscriptions/0',
    );
    await expect(scenario.step(`${STATE} has 0 items at "/missing"`)).rejects.toThrow('items of the array at /missing');
  });
});

describe('named credentials', () => {
  it('present the bearer token of the Sandbox profile and fail without it', async () => {
    const sut = await system('correct');
    const scenario = scenarioAt(sut.url);
    await scenario.step(`${STATE} has 0 items at "/subscriptions"`);
    expect(sut.received.map((request) => request.authorization)).toEqual([`Bearer ${STUB_TOKEN}`]);
    const wrongToken = scenarioAt(sut.url, { 'fixture-control': { scheme: 'bearer', token: 'not-the-token' } });
    const refused = wrongToken.step(`${STATE} has 0 items at "/subscriptions"`);
    await expect(refused).rejects.toThrow('inspection status of the state at /fixture/state');
    await expect(refused).rejects.not.toThrow('not-the-token');
    await expect(scenarioAt(sut.url, {}).step(`${STATE} has 0 items at "/subscriptions"`)).rejects.toThrow(
      'Credential "fixture-control" is not defined by the feature\'s Sandbox profile',
    );
    await expect(
      scenario.step('the state at "/fixture/state" as "Fixture Control" has 0 items at "/subscriptions"'),
    ).rejects.toThrow('credential name');
  });

  it('never come from a BLACKBOX_CREDENTIAL_<NAME> variable', async () => {
    const sut = await system('correct');
    process.env.BLACKBOX_CREDENTIAL_FIXTURE_CONTROL = STUB_TOKEN;
    try {
      await expect(scenarioAt(sut.url, {}).step(`${STATE} has 0 items at "/subscriptions"`)).rejects.toThrow(
        'is not defined by the feature\'s Sandbox profile',
      );
    } finally {
      delete process.env.BLACKBOX_CREDENTIAL_FIXTURE_CONTROL;
    }
    expect(sut.received).toEqual([]);
  });

  it('are never sent through a redirect', async () => {
    const sut = await system('correct');
    await expect(
      scenarioAt(sut.url).step('the state at "/fixture/moved" as "fixture-control" has 0 items at "/subscriptions"'),
    ).rejects.toThrow('inspection status of the state at /fixture/moved');
    expect(sut.received.map((request) => request.path)).toEqual(['/fixture/moved']);
  });
});
