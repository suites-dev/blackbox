// Explicit isolation case: the subscription-rejection suite on a per-test SUT stack.
// Every test boots its own fresh compose stack; state isolation is total,
// so the suite runs without any reset.
import { test } from '../../fixtures.js';
import { registerSubscriptionRejectionSuite } from '../../flows/subscription-rejection.system.suite.js';

// harness-only: this file and its per-worker counterpart register the same
// suite twice to prove our own sutIsolation modes both work; a real spec
// picks one isolation mode for its own tests, not both.
test.sut('subscription-system', { isolation: 'per-test' });
test.use({ effectsSnapshot: true });

registerSubscriptionRejectionSuite({ resetBeforeEach: false });
