// Explicit isolation case: the subscription-creation suite on a per-test SUT stack.
// Every test boots its own fresh compose stack; state isolation is total,
// so the suite runs without any reset.
import { test } from '../../fixtures.js';
import { registerSubscriptionCreationSuite } from '../../flows/subscription-creation.system.suite.js';

// decisionCoverage also writes Observable Decision Coverage evidence per test
// (decision arms from V8 coverage x boundary effects from the trace);
// aggregate with `npx tsx packages/report/text.ts` after the run.
//
// harness-only: this file and its per-worker counterpart register the same
// suite twice to prove our own sutIsolation modes both work; a real spec
// picks one isolation mode for its own tests, not both.
test.sut('subscription-system', { isolation: 'per-test' });
test.use({ effectsSnapshot: true, decisionCoverage: true });

registerSubscriptionCreationSuite({ resetBeforeEach: false });
