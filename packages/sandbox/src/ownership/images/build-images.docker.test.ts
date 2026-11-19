import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { composeProjectName, recoverSandbox, startSandbox } from '../../index.js';
import { readSandboxRecord, writeSandboxRecord } from '../records.js';
import type { SandboxInput } from '../../model/input.js';
import type { SandboxHandle } from '../../model/handle.js';

const dockerEnabled = process.env.BLACKBOX_SANDBOX_DOCKER_TEST === '1';
const base = 'busybox:1.36';

async function docker(...args: string[]) {
  return (await promisify(execFile)('docker', args, { timeout: 90_000 })).stdout.trim();
}

// Listing a precise reference distinguishes an absent tag from a failed daemon query.
function tagged(ref: string) {
  return docker('image', 'ls', '--no-trunc', '--quiet', '--filter', `reference=${ref}`);
}

async function baseImageId() {
  if (await tagged(base) === '') {
    await docker('image', 'pull', base);
  }
  const id = await tagged(base);
  expect(id).toMatch(/^sha256:[a-f0-9]{64}$/u);
  return id;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'bb-owned-build-'));
  const token = randomUUID();
  const catalog = `sut-bb-proof-${token}:local`;
  const alias = `bb-proof-${token}:extra`;
  const compose = [
    'services:', '  app:', `    image: ${catalog}`, '    build:', '      context: .',
    '      args:', '        MARK: ${MARK:?required}', '      tags:', `        - ${alias}`,
  ].join('\n');
  await writeFile(join(root, 'compose.yml'), compose);
  await writeFile(join(root, 'Dockerfile'), [
    `FROM ${base}`, 'ARG MARK', 'RUN printf "%s" "$MARK" >/marker', 'CMD ["sleep","180"]',
  ].join('\n'));
  const inputs = ['left', 'right'].map((mark): SandboxInput => ({
    projectDirectory: root, composeFiles: ['compose.yml'], sandboxId: `images-${mark}-${token}`,
    recordDirectory: join(root, 'records'), environment: { MARK: mark },
    serviceSelection: { kind: 'selected', services: ['app'] }, endpoints: [],
    startupTimeoutMs: 45_000, stopTimeoutMs: 20_000, telemetry: { kind: 'disabled' },
  }));
  return { root, catalog, alias, compose, inputs };
}

async function assertMarker(handle: SandboxHandle, marker: string) {
  const result = await handle.execute({ kind: 'container-exec', service: 'app', argv: ['cat', '/marker'] });
  expect(result).toMatchObject({ kind: 'exited', exitCode: 0, stdout: marker });
  const id = handle.getContainer({ service: 'app' }).testcontainer.id;
  const tag = await docker('container', 'inspect', '--format', '{{.Config.Image}}', id);
  expect(await tagged(tag)).toEqual(await docker('container', 'inspect', '--format', '{{.Image}}', id));
  return tag;
}

// Recreate an interrupted stop after the participant was removed but before the image cleanup.
async function interruptStop(input: SandboxInput, handle: SandboxHandle) {
  const record = await readSandboxRecord(input);
  if (record.state !== 'running') {
    throw new Error('expected a live Sandbox before interrupting teardown');
  }
  await writeSandboxRecord({ recordDirectory: input.recordDirectory, record: {
    ...record, state: 'stopping', revision: record.revision + 1, updatedAt: new Date().toISOString(),
  } });
  const id = handle.getContainer({ service: 'app' }).testcontainer.id;
  await docker('container', 'stop', '--time', '1', id);
  await docker('container', 'rm', id);
}

describe.skipIf(!dockerEnabled)('Docker build image ownership', () => {
  it('isolates concurrent builds, preserves both catalog tags and recovers the surviving project', async () => {
    const { root, catalog, alias, compose, inputs } = await fixture();
    const seeded: string[] = [];
    try {
      const baseline = await baseImageId();
      for (const ref of [catalog, alias]) {
        expect(await tagged(ref)).toBe('');
        await docker('image', 'tag', baseline, ref);
        seeded.push(ref);
      }
      const starts = await Promise.allSettled(inputs.map((sandbox) =>
        startSandbox({ sandbox, progress: { kind: 'silent' } })));
      const handles = starts.map((start) => {
        if (start.status === 'rejected') {
          throw start.reason;
        }
        return start.value;
      });
      const [left, right] = await Promise.all(handles.map((handle, index) =>
        assertMarker(handle, inputs[index].environment.MARK)));
      expect(left).not.toBe(right);
      expect(await Promise.all([catalog, alias].map(tagged))).toEqual([baseline, baseline]);
      await expect(handles[0].stop({ reason: 'completed' })).resolves.toMatchObject({ cleanup: 'complete' });
      expect(await tagged(left)).toBe('');
      expect(await assertMarker(handles[1], 'right')).toBe(right);
      await interruptStop(inputs[1], handles[1]);
      expect(await tagged(right)).toMatch(/^sha256:/u);
      await expect(recoverSandbox({ ...inputs[1], timeoutMs: 20_000 })).resolves.toMatchObject({ kind: 'sandbox-recovered' });
      expect(await tagged(right)).toBe('');
      expect(await Promise.all([catalog, alias].map(tagged))).toEqual([baseline, baseline]);
      expect(await readFile(join(root, 'compose.yml'), 'utf8')).toBe(compose);
      process.stdout.write(`BUILD_IMAGES ${JSON.stringify({ catalog, alias, baseline, left, right })}\n`);
    } finally {
      for (const input of inputs) {
        const recovered = await recoverSandbox({ ...input, timeoutMs: 20_000 });
        expect(recovered.kind).not.toBe('sandbox-recovery-failed');
        expect(await tagged(`blackbox-local/${composeProjectName(input)}:*`)).toBe('');
      }
      for (const ref of seeded) {
        if (await tagged(ref) !== '') {
          await docker('image', 'rm', ref);
        }
      }
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);

  it('removes an image built before a failed startup without rewriting a pre-existing tag', async () => {
    const { root, catalog, alias, inputs } = await fixture();
    const input = { ...inputs[0], endpoints: [{ name: 'closed', service: 'app', containerPort: 65000 }], startupTimeoutMs: 2_000 };
    let seeded = false;
    try {
      const baseline = await baseImageId();
      expect(await tagged(catalog)).toBe('');
      expect(await tagged(alias)).toBe('');
      await docker('image', 'tag', baseline, catalog);
      seeded = true;
      await expect(startSandbox({ sandbox: input, progress: { kind: 'silent' } })).rejects.toMatchObject({ name: 'SandboxStartError' });
      const journal = JSON.parse(await readFile(join(input.recordDirectory, `${input.sandboxId}.compose`, 'build-images.json'), 'utf8')) as {
        images: { tag: string; imageId: string }[];
      };
      expect(journal.images).toHaveLength(1);
      expect(journal.images[0].imageId).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(await tagged(journal.images[0].tag)).toBe('');
      expect(await tagged(catalog)).toBe(baseline);
      expect(await tagged(alias)).toBe('');
      process.stdout.write(`FAILED_START_IMAGES ${JSON.stringify({ catalog, baseline, built: journal.images[0] })}\n`);
    } finally {
      await recoverSandbox({ ...input, timeoutMs: 20_000 });
      if (seeded && await tagged(catalog) !== '') {
        await docker('image', 'rm', catalog);
      }
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});
