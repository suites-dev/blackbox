import { defineConfig } from "@playwright/test";
import { definePwBlackboxConfig } from "@suites/blackbox-runner-playwright";
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.FIXTURE_CONTROL_TOKEN ??= 'demo-fixture-token';
const e2eRoot = path.dirname(fileURLToPath(import.meta.url));

export default definePwBlackboxConfig(defineConfig({
	testDir: path.join(e2eRoot, 'tests'),
	// The historical Gherkin showcase is parser-regression input with no live SUT
	// (see tests/examples/gherkin/README.md).
	testIgnore: "**/examples/gherkin/**",
	// Named, not the implicit single default project (attempt-key collision
	// escalation): the per-test and per-worker profiles deliberately register
	// the SAME suite bodies twice, once per sutIsolation mode. Version 1 Node
	// activation rejects per-worker isolation before acquisition; retaining that
	// project keeps the unsupported capability visible instead of disguising it.
	// Once scenario identity resolves a real scenarioId from suite structure
	// (S3 lane A item 4), both registrations produce the SAME scenarioId, and
	// the analyzer's aggregation key is (scenarioId, project): under one
	// implicit project (name ""), that key would collide between the two
	// registrations and finalAttempts() would silently retain only one,
	// losing the other isolation mode's evidence. Naming a distinct project
	// per execution profile makes `project` disambiguate them honestly, with no
	// protocol change and no new aggregation-key dimension. subsystems/ gets
	// its own project for the same reason (a third real test population),
	// even though it has no per-worker counterpart today.
	projects: [
		{
			name: "per-test",
			testMatch: "systems/*/profiles/per-test/**/*.spec.ts",
		},
		{
			name: "per-worker",
			testMatch: "systems/*/profiles/per-worker/**/*.spec.ts",
		},
		{ name: "subsystem", testMatch: "subsystems/**/*.spec.ts" },
	],
	globalSetup: "./blackbox-global-setup.mjs",
	// Each test boots its own compose stack (see tests/support/fixtures.ts),
	// so tests are state-isolated by construction and parallelize freely.
	// The timeout covers the per-test stack boot.
	timeout: 120_000,
	// The Blackbox reporter emits the canonical report.html beside the sealed
	// run artifacts under .blackbox/runs/<runId>/.
	reporter: [
		["playwright-opentelemetry/reporter"],
		["list"],
		["junit", { outputFile: "test-results/junit.xml" }],
		["json", { outputFile: "test-results/results.json" }],
		["@suites/blackbox-runner-playwright/reporter"],
	],
	// Effects snapshots (see packages/analyzer/effects.ts, contract in packages/protocol/SCHEMA.md) live next to the specs that opted
	// in, one YAML per test, platform-independent:
	//   tests/<folder>/effects/<spec file>/effects-<flow>--flow-<digest>--scenario-<digest>.yaml
	// (Playwright sanitizes dots in snapshot names, hence the dash.)
	// `npx playwright test --update-snapshots` refreshes them; any drift in a
	// flow's observable side effects fails the test with a diff.
	snapshotPathTemplate: "{testDir}/{testFileDir}/effects/{testFileName}/{arg}{ext}",
	use: {
		trace: {
			mode: "on",
			screenshots: true,
			snapshots: false,
			sources: false,
			attachments: false,
		},
	},
	// The trace API is started detached by Blackbox global setup, not as a webServer:
	// Playwright stops webServers before the reporter's onEnd span upload runs.
}));
