import { definePwBlackboxConfig } from '@suites/blackbox-runner-playwright';
import type { PlaywrightTestConfig } from '@playwright/test';
import baseConfig from './playwright.config.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eRoot = path.dirname(fileURLToPath(import.meta.url));
const controlDirectory = process.env.BLACKBOX_E2E_CONTROL_DIR;

if (controlDirectory === undefined) {
	throw new Error('BLACKBOX_E2E_CONTROL_DIR is required for the per-worker negative control');
}

const resolvedControlDirectory = path.resolve(controlDirectory);
const resultsRoot = path.join(e2eRoot, 'test-results');

if (
	resolvedControlDirectory !== resultsRoot &&
	!resolvedControlDirectory.startsWith(`${resultsRoot}${path.sep}`)
) {
	throw new Error('The per-worker control output must stay under e2e/test-results');
}

const declaredProjects = baseConfig.projects ?? [];
const perWorkerProject = declaredProjects.filter((project) => project.name === 'per-worker');

if (perWorkerProject.length !== 1) {
	throw new Error(`Expected exactly one per-worker Playwright project, found ${perWorkerProject.length}`);
}

const config = {
	...baseConfig,
	projects: perWorkerProject,
	outputDir: path.join(resolvedControlDirectory, 'playwright-output'),
	reporter: [
		['playwright-opentelemetry/reporter'],
		['list'],
		['junit', { outputFile: path.join(resolvedControlDirectory, 'junit.xml') }],
		['json', { outputFile: path.join(resolvedControlDirectory, 'results.json') }],
		['@suites/blackbox-runner-playwright/reporter'],
	],
} satisfies PlaywrightTestConfig;

export default definePwBlackboxConfig(config);
