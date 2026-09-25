import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { composeProjectName } from '../lifecycle/helpers.js';
import { sandboxFixture } from '../lifecycle/runtime.fixture.js';
import { sandboxRecordSchema, sandboxRecordSchemaUrl } from '../schema/sandbox-record-schema.js';
import { SandboxRecordValidationError } from './record-decoder.js';
import { findInterruptedSandboxes, readSandboxRecord, recordedError } from './records.js';

function activeRecord(input: Awaited<ReturnType<typeof sandboxFixture>>['input']) {
  return {
    schemaVersion: 1,
    sandboxId: input.sandboxId,
    projectName: composeProjectName({ sandboxId: input.sandboxId }),
    composeFiles: input.composeFiles,
    state: 'running',
    revision: 2,
    admittedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
  } as const;
}

it('reports persisted nonterminal records as interrupted on later inspection', async () => {
  const { input } = await sandboxFixture();
  const recordPath = join(input.recordDirectory, `${input.sandboxId}.json`);
  await mkdir(input.recordDirectory, { recursive: true });
  await writeFile(recordPath, JSON.stringify(activeRecord(input)));
  const interrupted = await findInterruptedSandboxes({ recordDirectory: input.recordDirectory });
  expect(interrupted).toHaveLength(1);
  expect(interrupted[0]).toMatchObject({ status: 'interrupted', record: { state: 'running' } });
});

it('returns no interruption for a missing record directory', async () => {
  const { input } = await sandboxFixture();
  await expect(
    findInterruptedSandboxes({ recordDirectory: input.recordDirectory }),
  ).resolves.toEqual([]);
});

it('records non-Error failures without losing their value', () => {
  expect(recordedError('daemon refused')).toEqual({ name: 'Error', message: 'daemon refused' });
});

it('rejects structurally corrupt durable records on direct reads', async () => {
  const { input } = await sandboxFixture();
  await mkdir(input.recordDirectory, { recursive: true });
  await writeFile(
    join(input.recordDirectory, `${input.sandboxId}.json`),
    JSON.stringify({ ...activeRecord(input), revision: -1 }),
  );

  await expect(readSandboxRecord(input)).rejects.toThrow(SandboxRecordValidationError);
});

it('rejects unknown durable record fields during recovery discovery', async () => {
  const { input } = await sandboxFixture();
  await mkdir(input.recordDirectory, { recursive: true });
  await writeFile(
    join(input.recordDirectory, `${input.sandboxId}.json`),
    JSON.stringify({ ...activeRecord(input), futureField: true }),
  );

  await expect(findInterruptedSandboxes(input)).rejects.toThrow(/unevaluated properties/u);
});

it('exports the exact durable record schema and URL', () => {
  expect(sandboxRecordSchemaUrl.href).toMatch(/schema\/sandbox-record-v1\.json$/u);
  expect(sandboxRecordSchema).toMatchObject({
    $id: 'https://schemas.suites.dev/blackbox/sandbox-record/v1',
    oneOf: expect.any(Array),
  });
});
