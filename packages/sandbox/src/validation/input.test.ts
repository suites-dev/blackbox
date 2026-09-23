import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { composeProjectName } from '../lifecycle/helpers.js';
import { sandboxFixture } from '../lifecycle/runtime.fixture.js';
import type { SandboxInput } from '../types.js';
import { SandboxInputError, validateSandboxInput } from './input.js';

it('derives a stable collision-resistant Compose project name', () => {
  expect(composeProjectName({ sandboxId: 'Orders_Discovery.01' })).toMatch(
    /^bb-orders-discovery-01-[a-f0-9]{16}$/u,
  );
  expect(composeProjectName({ sandboxId: 'orders-discovery-01' })).not.toBe(
    composeProjectName({ sandboxId: 'orders_discovery_01' }),
  );
});

interface InvalidInputCase {
  readonly name: string;
  readonly change: (input: SandboxInput) => SandboxInput;
  readonly message: string;
}

const invalidInputs = [
  {
    name: 'invalid identity',
    change: (input) => ({ ...input, sandboxId: '!bad' }),
    message: 'sandboxId',
  },
  {
    name: 'relative project directory',
    change: (input) => ({ ...input, projectDirectory: '.' }),
    message: 'projectDirectory',
  },
  {
    name: 'relative record directory',
    change: (input) => ({ ...input, recordDirectory: '.' }),
    message: 'recordDirectory',
  },
  {
    name: 'empty Compose list',
    change: (input) => ({ ...input, composeFiles: [] }),
    message: 'at least one',
  },
  {
    name: 'absolute Compose path',
    change: (input) => ({ ...input, composeFiles: ['/tmp/a'] }),
    message: 'relative paths',
  },
  {
    name: 'duplicate Compose file',
    change: (input) => ({ ...input, composeFiles: [...input.composeFiles, ...input.composeFiles] }),
    message: 'duplicates',
  },
  {
    name: 'invalid service',
    change: (input) => ({
      ...input,
      serviceSelection: { kind: 'selected', services: ['bad service'] },
    }),
    message: 'invalid service',
  },
  {
    name: 'duplicate service',
    change: (input) => ({
      ...input,
      serviceSelection: { kind: 'selected', services: ['orders', 'orders'] },
    }),
    message: 'duplicates',
  },
  {
    name: 'empty services',
    change: (input) => ({ ...input, serviceSelection: { kind: 'selected', services: [] } }),
    message: 'at least one',
  },
  {
    name: 'duplicate endpoint',
    change: (input) => ({ ...input, endpoints: [...input.endpoints, ...input.endpoints] }),
    message: 'duplicates',
  },
  {
    name: 'invalid endpoint name',
    change: (input) => ({
      ...input,
      endpoints: [{ name: '!bad', service: 'orders', containerPort: 3000 }],
    }),
    message: 'endpoint name',
  },
  {
    name: 'invalid endpoint service',
    change: (input) => ({
      ...input,
      endpoints: [{ name: 'http', service: 'bad service', containerPort: 3000 }],
    }),
    message: 'endpoint service',
  },
  {
    name: 'invalid endpoint port',
    change: (input) => ({
      ...input,
      endpoints: [{ name: 'http', service: 'orders', containerPort: 0 }],
    }),
    message: 'container port',
  },
  {
    name: 'invalid environment name',
    change: (input) => ({ ...input, environment: { 'BAD=NAME': 'x' } }),
    message: 'environment variable name',
  },
  {
    name: 'invalid startup timeout',
    change: (input) => ({ ...input, startupTimeoutMs: 0 }),
    message: 'startupTimeoutMs',
  },
  {
    name: 'invalid stop timeout',
    change: (input) => ({ ...input, stopTimeoutMs: 3_600_001 }),
    message: 'stopTimeoutMs',
  },
] satisfies readonly InvalidInputCase[];

it.each(invalidInputs)('rejects $name', async ({ change, message }) => {
  const { input } = await sandboxFixture();
  await expect(validateSandboxInput(change(input))).rejects.toThrow(message);
});

it('accepts the explicit all-services variant', async () => {
  const { input } = await sandboxFixture();
  await expect(
    validateSandboxInput({
      ...input,
      serviceSelection: { kind: 'all', declaredServices: ['orders'] },
    }),
  ).resolves.toBeUndefined();
});

it('rejects a Compose symlink that escapes the project directory', async () => {
  const { input } = await sandboxFixture();
  const outside = await mkdtemp(join(tmpdir(), 'blackbox-outside-'));
  const outsideCompose = join(outside, 'compose.yaml');
  await writeFile(outsideCompose, 'services: {}\n');
  await symlink(outsideCompose, join(input.projectDirectory, 'catalog', 'outside.yaml'));
  await expect(
    validateSandboxInput({ ...input, composeFiles: ['catalog/outside.yaml'] }),
  ).rejects.toThrow('escapes projectDirectory');
});

it('validates explicit Compose inputs and rejects catalog-like path escape', async () => {
  const { input } = await sandboxFixture();
  await expect(validateSandboxInput(input)).resolves.toBeUndefined();
  await expect(
    validateSandboxInput({ ...input, composeFiles: ['../blackbox.config.yaml'] }),
  ).rejects.toBeInstanceOf(SandboxInputError);
  await expect(
    validateSandboxInput({
      ...input,
      endpoints: [{ name: 'http', service: 'postgres', containerPort: 5432 }],
    }),
  ).rejects.toThrow('not selected');
});
