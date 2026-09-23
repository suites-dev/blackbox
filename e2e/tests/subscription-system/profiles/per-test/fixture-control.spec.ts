// Explicit isolation case: the fixture-control suite on a per-test SUT stack.
// Every test boots its own fresh compose stack; state isolation is total,
// so the suite runs without any reset.
import { test } from '../../fixtures.js';
import { registerFixtureControlSuite } from '../../flows/fixture-control.system.suite.js';

// harness-only: this file and its per-worker counterpart register the same
// suite twice to prove our own sutIsolation modes both work; a real spec
// picks one isolation mode for its own tests, not both.
test.sut('subscription-system', { isolation: 'per-test' });
test.use({ effectsSnapshot: true });

registerFixtureControlSuite({ resetBeforeEach: false });
