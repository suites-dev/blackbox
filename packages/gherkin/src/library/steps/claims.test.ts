import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { json, scenarioAt } from '../testing/step-harness.js';
import { useStubSystems } from '../testing/stub-lifecycle.js';
import { STUB_TOKEN, type StubMode } from '../testing/stub-system.js';

// Requirements (task 2.3, report sections 2.10 and 6.2): response claims judge
// the latest stimulus's responses; state claims read an inspection endpoint
// with a named credential and address members by JSON Pointer. Each claim is
// shown to pass against the correct stub and to fail against spike E's no-row
// stub, which answers 201 without persisting the subscription.

const system = useStubSystems(beforeAll, afterEach);

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
  it('present the bearer token from BLACKBOX_CREDENTIAL_<NAME> and fail without it', async () => {
    const sut = await system('correct');
    const scenario = scenarioAt(sut.url);
    await scenario.step(`${STATE} has 0 items at "/subscriptions"`);
    expect(sut.received.map((request) => request.authorization)).toEqual([`Bearer ${STUB_TOKEN}`]);
    process.env.BLACKBOX_CREDENTIAL_FIXTURE_CONTROL = 'not-the-token';
    const refused = scenario.step(`${STATE} has 0 items at "/subscriptions"`);
    await expect(refused).rejects.toThrow('inspection status of the state at /fixture/state');
    await expect(refused).rejects.not.toThrow('not-the-token');
    delete process.env.BLACKBOX_CREDENTIAL_FIXTURE_CONTROL;
    await expect(scenario.step(`${STATE} has 0 items at "/subscriptions"`)).rejects.toThrow(
      'reads BLACKBOX_CREDENTIAL_FIXTURE_CONTROL, which is not set',
    );
    await expect(
      scenario.step('the state at "/fixture/state" as "Fixture Control" has 0 items at "/subscriptions"'),
    ).rejects.toThrow('credential name');
  });

  it('are never sent through a redirect', async () => {
    const sut = await system('correct');
    await expect(
      scenarioAt(sut.url).step('the state at "/fixture/moved" as "fixture-control" has 0 items at "/subscriptions"'),
    ).rejects.toThrow('inspection status of the state at /fixture/moved');
    expect(sut.received.map((request) => request.path)).toEqual(['/fixture/moved']);
  });
});
