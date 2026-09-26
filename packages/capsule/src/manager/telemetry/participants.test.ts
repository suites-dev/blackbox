import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { participantBootstrap, participantPlan } from './participants.fixture.js';
import { participantTelemetry } from './participants.js';

let projectDirectory = '';
let externalDirectory = '';

const bootstrap = () => participantBootstrap({ NODE_OPTIONS: ' --enable-source-maps ' });
const plan = (adapter: string) =>
  participantPlan({
    adapter,
    runtime: 'node',
    configured: true,
    projectDirectory,
  });

beforeAll(async () => {
  projectDirectory = await mkdtemp(join(tmpdir(), 'bb-participant-telemetry-'));
  externalDirectory = await mkdtemp(join(tmpdir(), 'bb-external-telemetry-'));
  const instrumentation = join(projectDirectory, '.blackbox', 'instrumentation');
  await mkdir(instrumentation, { recursive: true });
  await writeFile(join(instrumentation, 'instrumentation.js'), 'export {};\n');
  await writeFile(join(externalDirectory, 'instrumentation.js'), 'export {};\n');
});

afterAll(async () => {
  await Promise.all([
    rm(projectDirectory, { recursive: true, force: true }),
    rm(externalDirectory, { recursive: true, force: true }),
  ]);
});

describe('participant telemetry activation', () => {
  it.each([
    ['node-preload', '--enable-source-maps --require=/blackbox/instrumentation/instrumentation.js'],
    [
      'node-esm',
      '--enable-source-maps --experimental-loader=/blackbox/instrumentation/node_modules/' +
        '@opentelemetry/instrumentation/hook.mjs --require=/blackbox/instrumentation/instrumentation.js',
    ],
  ])('defers the effective %s environment merge to Sandbox', async (adapter, nodeOptions) => {
    await expect(
      participantTelemetry({ plan: plan(adapter), bootstrap: bootstrap() }),
    ).resolves.toMatchObject([
      {
        service: 'api',
        runtime: 'node',
        environment: {},
        activation: {
          kind: 'append-environment-variable',
          name: 'NODE_OPTIONS',
          value: nodeOptions.replace('--enable-source-maps ', ''),
        },
      },
    ]);
  });

  it('rejects an adapter the runtime provider does not implement', async () => {
    await expect(
      participantTelemetry({ plan: plan('node-register'), bootstrap: bootstrap() }),
    ).rejects.toThrow('Activation adapter "node-register" for runtime "node" is unavailable');
  });

  it('omits participants without configured instrumentation', async () => {
    const unconfigured = participantPlan({
      adapter: 'node-preload',
      runtime: 'node',
      configured: false,
      projectDirectory,
    });
    await expect(
      participantTelemetry({ plan: unconfigured, bootstrap: bootstrap() }),
    ).resolves.toEqual([]);
  });

  it('rejects configured runtimes without an activation provider', async () => {
    const python = participantPlan({
      adapter: 'node-preload',
      runtime: 'python',
      configured: true,
      projectDirectory,
    });
    await expect(participantTelemetry({ plan: python, bootstrap: bootstrap() })).rejects.toThrow(
      'Activation adapter "node-preload" for runtime "python" is unavailable',
    );
  });

  it('rejects activation assets outside the dedicated instrumentation directory', async () => {
    const configured = plan('node-preload');
    const unsafe = {
      ...configured,
      metadata: {
        ...configured.metadata,
        activations: {
          node: { ref: 'instrumentation.js', adapter: 'node-preload', version: 1 },
        },
      },
    };
    await expect(participantTelemetry({ plan: unsafe, bootstrap: bootstrap() })).rejects.toThrow(
      'must be inside .blackbox/instrumentation',
    );
  });
});

it('rejects an instrumentation directory symlink that escapes the project', async () => {
  const escapedProject = await mkdtemp(join(tmpdir(), 'bb-symlink-telemetry-'));
  try {
    await mkdir(join(escapedProject, '.blackbox'), { recursive: true });
    await symlink(externalDirectory, join(escapedProject, '.blackbox', 'instrumentation'));
    const escapedPlan = participantPlan({
      adapter: 'node-preload',
      runtime: 'node',
      configured: true,
      projectDirectory: escapedProject,
    });
    await expect(
      participantTelemetry({ plan: escapedPlan, bootstrap: bootstrap() }),
    ).rejects.toThrow('Instrumentation directory must resolve inside project directory');
  } finally {
    await rm(escapedProject, { recursive: true, force: true });
  }
});

it('rejects an activation asset symlink that escapes its instrumentation directory', async () => {
  const escapedAsset = join(projectDirectory, '.blackbox', 'instrumentation', 'escaped.js');
  await symlink(join(externalDirectory, 'instrumentation.js'), escapedAsset);
  try {
    const configured = plan('node-preload');
    const escapedPlan = {
      ...configured,
      metadata: {
        ...configured.metadata,
        activations: {
          node: {
            ref: '.blackbox/instrumentation/escaped.js',
            adapter: 'node-preload',
            version: 1,
          },
        },
      },
    };
    await expect(
      participantTelemetry({ plan: escapedPlan, bootstrap: bootstrap() }),
    ).rejects.toThrow('must be inside .blackbox/instrumentation');
  } finally {
    await rm(escapedAsset, { force: true });
  }
});
