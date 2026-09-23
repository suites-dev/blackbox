// Explicit isolation case: the fixture-control suite on a per-worker SUT stack.
// All tests of this worker share one compose stack; the suite options
// below state explicitly how the suite copes with the shared state.
import { test } from '../../fixtures.js';
import { registerFixtureControlSuite } from '../../flows/fixture-control.system.suite.js';

// harness-only: this file and its per-test counterpart register the same
// suite twice to prove our own sutIsolation modes both work; a real spec
// picks one isolation mode for its own tests, not both.
test.sut('subscription-system', { isolation: 'per-worker' });

registerFixtureControlSuite({ resetBeforeEach: true });
