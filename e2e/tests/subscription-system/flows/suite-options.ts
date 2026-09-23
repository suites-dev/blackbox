// Shared contract for the suite modules in this folder.
//
// The suites are the single source of truth for WHAT is tested. The spec
// files under profiles/per-test/ and profiles/per-worker/ decide HOW the SUT stack
// is scoped (test.use({ sutIsolation })) and pass the matching options here,
// so every isolation case is explicit in the spec file that runs it.
import { expect, test } from "../fixtures.js";
import { fixtureControlHeaders } from "../sut.js";

export interface SuiteOptions {
	/**
	 * true when the suite runs on a stack shared with other tests
	 * (sutIsolation: "per-worker"). Suites that assert global fixture state
	 * then reset the SUT to the fresh profile before each test, because the
	 * shared stack carries state left by earlier tests.
	 *
	 * false on per-test stacks: every test's stack is born clean, so a reset
	 * would be dead code.
	 */
	// harness-only: this flag exists to compensate for the demo SUT's shared
	// compose stack between tests; it is not a product option a real suite
	// would expose.
	readonly resetBeforeEach: boolean;
}

/**
 * Registers the reset hook a suite needs on a shared stack. Call inside the
 * suite's describe block; a no-op when resetBeforeEach is false.
 */
// harness-only: resets the demo SUT's own state via its /fixture/reset
// endpoint between tests; a real product has no such reset endpoint to call.
export function registerResetHook(options: SuiteOptions): void {
	if (!options.resetBeforeEach) {return;}
	test.beforeEach(async ({ request }) => {
		await test.step("Arrange: reset the shared stack to the fresh profile", async () => {
			const reset = await request.post("/fixture/reset", {
				data: { profile: "fresh" },
				headers: fixtureControlHeaders(),
			});
			expect(reset.status()).toBe(200);
		});
	});
}
