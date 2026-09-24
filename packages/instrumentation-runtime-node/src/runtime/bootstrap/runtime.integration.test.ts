import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import {
  installInstrumentation,
  instrumentationDirectoryRelativePath,
} from '@suites/blackbox-instrumentation-internal';

import { nodeRuntimeProvider } from './provider.js';

const commonJsApplication = `
const http = require('node:http');
const server = http.createServer((_request, response) => response.end('ok'));
server.listen(0, '127.0.0.1', () => {
  http.get({ host: '127.0.0.1', port: server.address().port }, (response) => {
    response.resume();
    response.once('end', () => server.close(() => setTimeout(() => process.exit(0), 250)));
  });
});
`;

const moduleApplication = `
import http from 'node:http';
const server = http.createServer((_request, response) => response.end('ok'));
server.listen(0, '127.0.0.1', () => {
  http.get({ host: '127.0.0.1', port: server.address().port }, (response) => {
    response.resume();
    response.once('end', () => server.close(() => setTimeout(() => process.exit(0), 250)));
  });
});
`;

function telemetryEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    OTEL_SERVICE_NAME: 'blackbox-instrumentation-integration',
    OTEL_TRACES_EXPORTER: 'console',
    OTEL_METRICS_EXPORTER: 'none',
    OTEL_LOGS_EXPORTER: 'none',
    OTEL_BSP_SCHEDULE_DELAY: '25',
  };
}

function expectHttpSpans(result: ReturnType<typeof spawnSync>): void {
  expect(result.status, result.stderr.toString()).toBe(0);
  const output = result.stdout.toString();
  expect(output).toContain('@opentelemetry/instrumentation-http');
  expect(output).toMatch(/traceId: '[0-9a-f]{32}'/u);
  expect(output).toMatch(/id: '[0-9a-f]{16}'/u);
  expect(output).toMatch(/name: 'GET'/u);
  expect(output).toMatch(/kind: [12]/u);
}

it('installs a standalone dependency tree and instruments real CommonJS and ESM applications', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'blackbox-real-instrumentation-'));
  try {
    const installation = await installInstrumentation({
      projectDirectory,
      runtime: 'node',
      providers: [nodeRuntimeProvider],
    });
    if (!installation.ok) {
      throw new Error(installation.message);
    }
    const directory = join(projectDirectory, instrumentationDirectoryRelativePath);
    const bootstrap = join(directory, 'instrumentation.js');
    const hook = join(directory, 'node_modules', '@opentelemetry', 'instrumentation', 'hook.mjs');
    expect(await readFile(hook, 'utf8')).toContain("from 'import-in-the-middle/hook.mjs'");

    const commonJsEntry = join(projectDirectory, 'application.cjs');
    await writeFile(commonJsEntry, commonJsApplication);
    expectHttpSpans(
      spawnSync(process.execPath, ['--require', bootstrap, commonJsEntry], {
        cwd: projectDirectory,
        encoding: 'utf8',
        env: telemetryEnvironment(),
        timeout: 15_000,
      }),
    );

    const moduleEntry = join(projectDirectory, 'application.mjs');
    await writeFile(moduleEntry, moduleApplication);
    expectHttpSpans(
      spawnSync(
        process.execPath,
        [`--experimental-loader=${hook}`, '--import', bootstrap, moduleEntry],
        {
          cwd: projectDirectory,
          encoding: 'utf8',
          env: telemetryEnvironment(),
          timeout: 15_000,
        },
      ),
    );
  } finally {
    await rm(projectDirectory, { recursive: true, force: true });
  }
});
