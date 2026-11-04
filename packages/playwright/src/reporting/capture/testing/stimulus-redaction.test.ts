import type { TestInfo } from '@playwright/test';
import { describe, expect, it } from 'vitest';

import type { RecordedStimuli } from '../../../effects/attempt-effects.js';
import { AttemptReport } from '../../attempt.js';
import { stimulusSection } from '../envelope.js';

const recorded = (path: string, origin: string | null = null): RecordedStimuli => ({
  stimuli: [
    {
      title: 'When',
      requests: [
        {
          method: 'POST',
          target: 'entrypoint',
          origin,
          path,
          query: null,
          body: null,
          contentType: null,
          headers: {},
        },
      ],
    },
  ],
  unscoped: 0,
  opaque: 0,
});

describe('recorded stimuli of an attempt', () => {
  it('lose a known secret from a request path and become unestablished', () => {
    const report = new AttemptReport({} as TestInfo);
    report.protect({ API_TOKEN: 'synthetic-token-value' });
    const redacted = report.redactStimuli(recorded('/reset/synthetic-token-value'));
    expect(JSON.stringify(redacted)).not.toContain('synthetic-token-value');
    expect(stimulusSection(redacted).fingerprint).toBeNull();
  });

  it('keep an ordinary path and its fingerprint', () => {
    const report = new AttemptReport({} as TestInfo);
    report.protect({ API_TOKEN: 'synthetic-token-value' });
    expect(stimulusSection(report.redactStimuli(recorded('/orders'))).fingerprint).not.toBeNull();
  });

  it('lose a known secret from an external origin and become unestablished', () => {
    const report = new AttemptReport({} as TestInfo);
    report.protect({ API_TOKEN: 'synthetic-token-value' });
    const redacted = report.redactStimuli(
      recorded('/x', 'https://synthetic-token-value.example.test'),
    );
    expect(JSON.stringify(redacted)).not.toContain('synthetic-token-value');
    expect(stimulusSection(redacted).fingerprint).toBeNull();
  });
});
