import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { captureCapture } from './configuration.js';

it('changes the capture fingerprint when collector redaction is configured', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bb-policy-'));
  const path = join(directory, 'compose.json');
  try {
    const document = (environment: object) =>
      JSON.stringify({
        services: {
          'blackbox-otel-collector': { image: 'collector', environment },
        },
      });
    await writeFile(path, document({}));
    const before = await captureCapture(path);
    await writeFile(
      path,
      document({
        BLACKBOX_OTEL_REDACTION_POLICY: 'credentials-v1',
        BLACKBOX_OTEL_REDACTION_SECRETS: '${BLACKBOX_SANDBOX_OTEL_REDACTION_SECRETS}',
      }),
    );
    const after = await captureCapture(path);
    expect(after.digest).not.toBe(before.digest);
    expect(after.collector.limits.BLACKBOX_OTEL_REDACTION_POLICY).toBe('credentials-v1');
    expect(JSON.stringify(after)).not.toContain('REDACTION_SECRETS');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
