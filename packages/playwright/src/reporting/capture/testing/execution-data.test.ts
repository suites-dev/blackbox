import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { APIRequestContext, TestInfo } from '@playwright/test';
import { expect, it } from 'vitest';
import { AttemptReport } from '../../attempt.js';
import { createStateRegistry } from '../../../state/registry.js';
import { outputCapture } from '../../../stimulus/lifecycle/output.js';

it('retains admitted multiline strings and their distinct suffixes while redacting credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-execution-data-'));
  const attachments: string[] = [];
  const report = new AttemptReport({
    outputPath: (...parts: string[]) => join(directory, ...parts),
    attach: (_name: string, { body }: { body: string }) => { attachments.push(body); return Promise.resolve(); },
  } as TestInfo);
  report.protect({ API_TOKEN: 'synthetic-private-value' });
  const original = `${'x'.repeat(1500)}\n\tapproved\u0000`;
  const changed = `${'x'.repeat(1500)}\n\trejected\u0000`;
  const registry = createStateRegistry();
  try {
    let value = original;
    registry.state.observe('text', { value: () => value });
    const selection = registry.select();
    const initial = await selection.capture();
    value = changed;
    const final = await selection.capture();
    const redact = (text: string) => report.redact(text);
    const output = outputCapture({} as APIRequestContext, redact);
    const first = await output.capture({ value: original, token: 'unconfigured-credential', echo: 'synthetic-private-value' });
    const second = await output.capture({ value: changed });
    await report.executionArtifact('execution-evidence', {
      first, second, initial: selection.serialize(initial.checkpoint, redact),
      final: selection.serialize(final.checkpoint, redact),
      diff: selection.serializeBetween(initial.checkpoint, final.checkpoint, redact),
      credentialText: 'Bearer synthetic-bearer',
    });
    expect(attachments).toHaveLength(1);
    const document = JSON.parse(attachments[0]);
    expect(document.first.value).toEqual({ value: original, token: '[REDACTED]', echo: '[REDACTED]' });
    expect(document.second.value.value).toBe(changed);
    expect(document.initial.observers[0].readers[0].value).toBe(original);
    expect(document.final.observers[0].readers[0].value).toBe(changed);
    expect(document.diff.observers[0].diff.value).toEqual({ before: original, after: changed, changed: true });
    expect(document.credentialText).toBe('Bearer [REDACTED]');
    expect(await readFile(join(directory, 'blackbox/execution-evidence/1/blackbox-execution.json'), 'utf8')).toBe(attachments[0]);
    expect(report.attachedEvidence()).toHaveLength(1);
  } finally { registry.close(); await rm(directory, { recursive: true, force: true }); }
});

it('does not write or attach an execution artifact after its lease is revoked during directory preparation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-execution-revoked-'));
  const controller = new AbortController();
  const attachments: string[] = [];
  const report = new AttemptReport({
    outputPath: (...parts: string[]) => { controller.abort(new Error('capture revoked')); return join(directory, ...parts); },
    attach: (name: string) => { attachments.push(name); return Promise.resolve(); },
  } as TestInfo);
  try {
    await expect(report.executionArtifact('stimulus-effects', {}, {
      signal: controller.signal, check: () => { controller.signal.throwIfAborted(); },
    })).rejects.toThrow('capture revoked');
    expect(attachments).toEqual([]);
    expect(report.attachedEvidence()).toEqual([]);
    await expect(readFile(join(directory, 'blackbox/execution-evidence/1/effects.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
