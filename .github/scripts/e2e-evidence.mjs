#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { capsuleEvidenceRoots, capsuleEvidenceSources, requireCapsuleSuccessEvidence } from './capsule-evidence-sources.mjs';

const SOURCES = ['e2e/.blackbox/runs', 'e2e/.blackbox/reports', 'e2e/test-results'];

async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function containedPath(root, relative) {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) {
    throw new Error(`Expected a root-contained path: ${relative}`);
  }
  const target = path.resolve(root, relative);
  if (target === root) throw new Error('Cannot use the workspace root as an output');
  let current = root;
  for (const part of path.relative(root, target).split(path.sep)) {
    current = path.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) {
        throw new Error(`Evidence paths cannot traverse symlinks: ${current}`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return target;
}

async function inventory(root, project) {
  const entries = [];
  const sources = [];
  async function visit(relative) {
    const absolute = path.join(root, relative);
    const stat = await fs.lstat(absolute);
    if (stat.isDirectory()) {
      entries.push({ path: relative, type: 'directory' });
      for (const name of (await fs.readdir(absolute)).sort()) {
        await visit(`${relative}/${name}`);
      }
    } else if (stat.isFile()) {
      entries.push({
        path: relative,
        type: 'file',
        bytes: stat.size,
        sha256: await digest(absolute),
      });
    } else {
      throw new Error(`Unsupported evidence entry (not followed): ${relative}`);
    }
  }
  const selectedSources = project === 'capsule' ? await capsuleEvidenceSources(root) : SOURCES;
  for (const source of selectedSources) {
    await containedPath(root, source);
    try {
      const stat = await fs.lstat(path.join(root, source));
      if (source.startsWith('e2e/.blackbox/tmp/') && !stat.isFile()) {
        throw new Error(`Capsule runtime receipt must be a regular file: ${source}`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      sources.push({ path: source, status: 'missing' });
      continue;
    }
    sources.push({ path: source, status: 'present' });
    await visit(source);
  }
  return { sources, entries };
}

export async function retainE2eEvidence({
  root = process.cwd(),
  outputDir = '.blackbox/tmp/ci-e2e-transport',
  testOutcome = 'not-run',
  tarCommand = 'tar',
  project = 'legacy-harness',
} = {}) {
  root = await fs.realpath(root);
  const output = await containedPath(root, outputDir);
  const protectedSources = project === 'capsule' ? [...capsuleEvidenceRoots, 'e2e/.blackbox/tmp'] : SOURCES;
  for (const source of protectedSources) {
    const absolute = path.join(root, source);
    if (output === absolute || output.startsWith(`${absolute}${path.sep}`)) {
      throw new Error('Archive output cannot be inside an evidence source');
    }
  }
  await fs.mkdir(path.dirname(output), { recursive: true });
  // A repeated invocation must not overwrite a prior receipt or transport archive.
  await fs.mkdir(output);
  const receipt = {
    schemaVersion: 1,
    purpose: project === 'capsule' ? 'capsule-harness-evidence-transport' : 'legacy-harness-evidence-transport',
    testOutcome,
    productConformance: false,
    productExecutionIds: null,
    identityLimitation: 'File paths are retained observations, not validated product identities.',
    startedAt: new Date().toISOString(),
    status: 'failed',
    sources: [],
    entries: [],
    archive: null,
    error: null,
  };
  try {
    const before = await inventory(root, project);
    Object.assign(receipt, before);
    const list = path.join(output, 'archive-inputs.list');
    await fs.writeFile(list, before.entries.map((entry) => `./${entry.path}\0`).join(''));
    const archive = path.join(output, 'evidence.tar');
    const args = ['-cf', archive, '--no-recursion', '--null', '-T', list];
    const result = spawnSync(tarCommand, args, {
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, COPYFILE_DISABLE: '1' },
    });
    await fs.writeFile(
      path.join(output, 'archive.log'),
      JSON.stringify(
        {
          command: [tarCommand, ...args],
          status: result.status,
          signal: result.signal,
          error: result.error?.message ?? null,
          stdout: result.stdout,
          stderr: result.stderr,
        },
        null,
        2,
      ),
    );
    if (result.error || result.status !== 0)
      throw new Error('Archive command failed; see archive.log');
    const after = await inventory(root, project);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error('Evidence changed during archiving; archive is not a verified snapshot');
    }
    receipt.archive = { path: 'evidence.tar', sha256: await digest(archive) };
    if (project === 'capsule' && testOutcome === 'success') {
      await requireCapsuleSuccessEvidence(root, before.entries);
    }
    if (project !== 'capsule' && ['success', 'failure'].includes(testOutcome)) {
      const required = ['e2e/test-results/junit.xml', 'e2e/test-results/results.json'];
      const missing = required.filter(
        (name) =>
          !before.entries.some(
            (entry) => entry.path === name && entry.type === 'file' && entry.bytes > 0,
          ),
      );
      if (missing.length)
        throw new Error(`Missing required Playwright reports: ${missing.join(', ')}`);
    }
    receipt.status = 'complete';
  } catch (error) {
    receipt.error = error.message;
  }
  receipt.endedAt = new Date().toISOString();
  await fs.writeFile(
    path.join(output, 'transport-receipt.json'),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  retainE2eEvidence({
    testOutcome: process.env.E2E_TEST_OUTCOME || 'not-run',
    project: process.env.E2E_PROJECT || 'legacy-harness',
  })
    .then((receipt) => {
      process.stdout.write(`${JSON.stringify(receipt)}\n`);
      process.exitCode = receipt.status === 'complete' ? 0 : 1;
    })
    .catch((error) => {
      process.stderr.write(`${error.stack}\n`);
      process.exitCode = 1;
    });
}
