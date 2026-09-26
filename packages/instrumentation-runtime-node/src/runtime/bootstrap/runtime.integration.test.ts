import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import {
  installInstrumentation,
  instrumentationDirectoryRelativePath,
} from '@suites/blackbox-instrumentation-internal';

import { createNodeRuntimeActivation, type NodeRuntimeActivationAdapter } from './activation.js';
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
    TRACEPARENT: '00-0102030405060708090a0b0c0d0e0f10-1112131415161718-01',
    OTEL_SERVICE_NAME: 'blackbox-instrumentation-integration',
    OTEL_TRACES_EXPORTER: 'console',
    OTEL_METRICS_EXPORTER: 'none',
    OTEL_LOGS_EXPORTER: 'none',
    OTEL_BSP_SCHEDULE_DELAY: '25',
  };
}

function activatedEnvironment(input: {
  readonly adapter: NodeRuntimeActivationAdapter;
  readonly bootstrap: string;
  readonly directory: string;
}): NodeJS.ProcessEnv {
  const activation = createNodeRuntimeActivation({
    kind: 'node-runtime-activation',
    adapter: input.adapter,
    bootstrapPath: input.bootstrap,
    dependencyDirectory: join(input.directory, 'node_modules'),
    inheritedNodeOptions: { kind: 'present', value: '--enable-source-maps' },
  });
  return { ...telemetryEnvironment(), ...activation.environment };
}

function expectHttpSpans(result: ReturnType<typeof spawnSync>): void {
  expect(result.status, result.stderr.toString()).toBe(0);
  const output = result.stdout.toString();
  expect(output).toContain('@opentelemetry/instrumentation-http');
  expect(output).toContain("traceId: '0102030405060708090a0b0c0d0e0f10'");
  expect(output).toContain("spanId: '1112131415161718'");
  expect(output).toMatch(/id: '[0-9a-f]{16}'/u);
  expect(output).toMatch(/name: 'GET'/u);
  expect(output).toMatch(/kind: [12]/u);
}

async function expectApplicationSignalHandler(input: {
  readonly bootstrap: string;
  readonly directory: string;
}): Promise<void> {
  const marker = join(input.directory, 'signal-handler-completed');
  const entry = join(input.directory, 'signal-application.cjs');
  await writeFile(entry, `
    const { writeFileSync } = require('node:fs');
    process.on('SIGTERM', () => {
      setTimeout(() => {
        writeFileSync(${JSON.stringify(marker)}, 'complete');
        process.exit(0);
      }, 100);
    });
    process.stdout.write('ready\\n');
    setInterval(() => undefined, 1_000);
  `);
  const child = spawn(process.execPath, [entry], {
    cwd: input.directory,
    env: activatedEnvironment({
      adapter: 'node-preload',
      bootstrap: input.bootstrap,
      directory: input.directory,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('signal application did not become ready'));
    }, 10_000);
    child.stdout.once('data', () => {
      clearTimeout(timeout);
      resolve();
    });
    child.once('error', reject);
  });
  child.kill('SIGTERM');
  const [exitCode, signal] = await once(child, 'exit');
  expect({ exitCode, signal }).toEqual({ exitCode: 0, signal: null });
  expect(await readFile(marker, 'utf8')).toBe('complete');
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
      spawnSync(process.execPath, [commonJsEntry], {
        cwd: projectDirectory,
        encoding: 'utf8',
        env: activatedEnvironment({ adapter: 'node-preload', bootstrap, directory }),
        timeout: 15_000,
      }),
    );

    const moduleEntry = join(projectDirectory, 'application.mjs');
    await writeFile(moduleEntry, moduleApplication);
    expectHttpSpans(
      spawnSync(process.execPath, [moduleEntry], {
        cwd: projectDirectory,
        encoding: 'utf8',
        env: activatedEnvironment({ adapter: 'node-esm', bootstrap, directory }),
        timeout: 15_000,
      }),
    );

    await expectApplicationSignalHandler({ bootstrap, directory });

    const invalidContext = spawnSync(process.execPath, ['--eval', 'void 0'], {
      cwd: projectDirectory,
      encoding: 'utf8',
      env: {
        ...activatedEnvironment({ adapter: 'node-preload', bootstrap, directory }),
        TRACEPARENT: 'invalid',
      },
      timeout: 15_000,
    });
    expect(invalidContext.status).not.toBe(0);
    expect(invalidContext.stderr).toContain(
      'TRACEPARENT does not contain valid W3C trace context.',
    );
  } finally {
    await rm(projectDirectory, { recursive: true, force: true });
  }
});
