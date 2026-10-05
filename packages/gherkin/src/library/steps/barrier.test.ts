import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { json, scenarioAt } from '../testing/step-harness.js';
import { useStubSystems } from '../testing/stub-lifecycle.js';
import type { StubSystem } from '../testing/stub-system.js';

// Requirements (task 2.3, report section 2.11): the synchronous seal needs a
// stimulus whose responses arrived; a polling barrier re-reads a real
// completion condition until it holds and fails once the deadline written in
// the feature passes. Negative control: the no-row stub never enqueues the
// order, so its flow never completes. The stub enqueues an order one second
// after a pro user's subscription.

const system = useStubSystems(beforeAll, afterEach);

// Playwright stops polling once the next interval would pass the deadline, so a
// barrier gives up within one interval (at most 1s) before it, never after it.
function expectGaveUpAtDeadline(started: number, polls: number): void {
  const elapsed = Date.now() - started;
  expect(elapsed).toBeGreaterThanOrEqual(750);
  expect(elapsed).toBeLessThan(3000);
  expect(polls).toBeGreaterThanOrEqual(3);
}

const inspections = (sut: StubSystem): number =>
  sut.received.filter((request) => request.path === '/fixture/state').length;

const ALICE = json('{"userId": "alice", "paymentMethodId": "pm_alice_primary"}');
const SUBSCRIBE = 'the client sends POST "/subscriptions" with JSON:';
const ORDERS_EQUAL = (seconds: number) =>
  `the flow is sealed within ${seconds} seconds when the state at "/fixture/state" as "fixture-control" has "/orders" equal to:`;
const ORDER_COUNT = (seconds: number) =>
  `the flow is sealed within ${seconds} seconds when the state at "/fixture/state" as "fixture-control" has 1 item at "/orders"`;
const ALICE_ORDER = json('[{"id": "order_alice", "userId": "alice"}]');

describe('the flow is sealed by the terminal response(s)', () => {
  it('holds after a stimulus and fails when only setup ran', async () => {
    const scenario = scenarioAt((await system('correct')).url);
    await expect(scenario.step('the flow is sealed by the terminal response')).rejects.toThrow(
      'stimulus steps before this step',
    );
    await scenario.step('the client has sent POST "/subscriptions" with JSON and received 201:', ALICE);
    await expect(scenario.step('the flow is sealed by the terminal responses')).rejects.toThrow(
      'stimulus steps before this step',
    );
    await scenario.step(SUBSCRIBE, json('{"userId": "bob", "paymentMethodId": "pm_bob_one"}'));
    await scenario.step('the flow is sealed by the terminal response');
  });
});

describe('the flow is sealed within {int} second(s) when ... equal to:', () => {
  it('waits for the asynchronous completion a single read misses', async () => {
    const scenario = scenarioAt((await system('correct')).url);
    await scenario.step(SUBSCRIBE, ALICE);
    await expect(
      scenario.step('the state at "/fixture/state" as "fixture-control" has "/orders" equal to:', ALICE_ORDER),
    ).rejects.toThrow('/orders in the state at /fixture/state');
    await scenario.step(ORDERS_EQUAL(5), ALICE_ORDER);
  });

  it('fails at the stated deadline when the flow never completes (no-row)', async () => {
    const sut = await system('no-row');
    const scenario = scenarioAt(sut.url);
    await scenario.step(SUBSCRIBE, ALICE);
    const started = Date.now();
    await expect(scenario.step(ORDERS_EQUAL(1), ALICE_ORDER)).rejects.toThrow(
      'flow sealed when /orders in the state at /fixture/state as "fixture-control" equals the doc string',
    );
    expectGaveUpAtDeadline(started, inspections(sut));
  });
});

describe('the flow is sealed within {int} second(s) when ... has {int} item(s) at {string}', () => {
  it('waits for the item to appear and fails at the deadline when it never does (no-row)', async () => {
    const correct = scenarioAt((await system('correct')).url);
    await correct.step(SUBSCRIBE, ALICE);
    await correct.step(ORDER_COUNT(5));
    const sut = await system('no-row');
    const noRow = scenarioAt(sut.url);
    await noRow.step(SUBSCRIBE, ALICE);
    const started = Date.now();
    await expect(noRow.step(ORDER_COUNT(1))).rejects.toThrow('flow sealed when the state at /fixture/state');
    expectGaveUpAtDeadline(started, inspections(sut));
  });
});

describe('polling barrier preconditions', () => {
  it('refuses a deadline below one second, an unset credential and a bad pointer before polling', async () => {
    const sut = await system('correct');
    const scenario = scenarioAt(sut.url);
    await expect(scenario.step(ORDERS_EQUAL(0), ALICE_ORDER)).rejects.toThrow('barrier deadline in seconds');
    await expect(scenario.step(ORDER_COUNT(-1))).rejects.toThrow('barrier deadline in seconds');
    await expect(
      scenario.step(
        'the flow is sealed within 1 second when the state at "/fixture/state" as "fixture-control" has 1 item at "orders"',
      ),
    ).rejects.toThrow('JSON Pointer (RFC 6901)');
    delete process.env.BLACKBOX_CREDENTIAL_FIXTURE_CONTROL;
    await expect(scenario.step(ORDER_COUNT(1))).rejects.toThrow(
      'Credential "fixture-control" reads BLACKBOX_CREDENTIAL_FIXTURE_CONTROL, which is not set in the runner environment',
    );
    expect(sut.received).toEqual([]);
  });
});
