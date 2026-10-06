import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { useStubSystems } from './testing/stub-lifecycle.js';
import { featureFixture, planWorkedExample, scenarioSteps, verdicts } from './testing/worked-examples.js';

// Requirement (task 2.3 acceptance): the library is qualified with spike E's
// no-row negative control. The report's worked example (section 6.1, without
// effects rows, plus a polling barrier) compiles against the real library and
// runs scenario by scenario, each against a fresh stub: every scenario is
// supported by the correct stub, and the no-row stub, which answers 201 but
// never persists the row, turns exactly the scenarios that depend on the row
// not supported, at the claim that notices.

const system = useStubSystems(beforeAll, afterEach);
const FEATURE = featureFixture('subscription-intake.feature');

const ELIGIBLE = 'Scenario: an eligible user receives an active subscription';
const GHOST = 'Scenario: an unknown user is rejected without side effects [user=ghost-user, method=pm_ghost]';
const MALLORY = 'Scenario: an unknown user is rejected without side effects [user=mallory, method=pm_mallory_1]';
const LOCAL = 'Scenario: a local-only user activates without ordering';
const REPEATED = 'Scenario: a repeated request does not repeat downstream effects';
const CONCURRENT = 'Scenario: concurrent requests create exactly one subscription';

describe('worked example against the library', () => {
  it('compiles every step against the shared library', async () => {
    expect(scenarioSteps(await planWorkedExample(FEATURE)).map((scenario) => scenario.title)).toEqual([
      ELIGIBLE,
      GHOST,
      MALLORY,
      LOCAL,
      REPEATED,
      CONCURRENT,
    ]);
  });

  it('is supported by the correct stub', async () => {
    expect(await verdicts(FEATURE, system, 'correct')).toEqual({
      [ELIGIBLE]: 'supported',
      [GHOST]: 'supported',
      [MALLORY]: 'supported',
      [LOCAL]: 'supported',
      [REPEATED]: 'supported',
      [CONCURRENT]: 'supported',
    });
  });

  it('turns the scenarios that need the row not supported under no-row', async () => {
    expect(await verdicts(FEATURE, system, 'no-row')).toEqual({
      [ELIGIBLE]:
        'not supported at line 29: And the state at "/fixture/state" as "fixture-control" has "/subscriptions" equal to:',
      [GHOST]: 'supported',
      [MALLORY]: 'supported',
      [LOCAL]: 'supported',
      [REPEATED]: 'not supported at line 85: And the response status is 409',
      [CONCURRENT]: 'not supported at line 95: And the response statuses are "201, 409"',
    });
  });
});
