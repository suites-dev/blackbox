import { realpathSync } from 'node:fs';
import { relative } from 'node:path';

import type { TestInfo } from '@playwright/test';
import type { BlackboxSandbox, BlackboxTelemetry } from '../types.js';

import {
  attemptAttachment,
  progressAttachment,
  type AttemptEvent,
  type AttemptProgress,
} from './events.js';
import { reportText } from './text.js';

/** Attachments use Playwright's worker transport and remain available to other reporters. */
export class AttemptReport implements AttemptProgress {
  private readonly started = Date.now();
  private readonly events: AttemptEvent[] = [];
  private readonly secrets = new Set<string>();
  private pending = Promise.resolve();
  private attachmentFailure: unknown = null;
  private dropped = 0;
  private closed = false;
  private identity:
    | { readonly kind: 'not-ready' }
    | {
        readonly kind: 'acquired';
        readonly sandboxId: string;
        readonly executionId: string;
        readonly sessionId: string;
        readonly catalogEntry: BlackboxSandbox['catalogEntry'];
      } = { kind: 'not-ready' };

  constructor(private readonly testInfo: TestInfo) {}

  acquired(sandbox: BlackboxSandbox, telemetry: BlackboxTelemetry): void {
    this.identity = {
      kind: 'acquired',
      sandboxId: sandbox.sandboxId,
      executionId: sandbox.executionId,
      sessionId: telemetry.sessionId,
      catalogEntry: sandbox.catalogEntry,
    };
  }

  protect(values: Readonly<Record<string, string>>): void {
    for (const value of Object.values(values)) {
      if (value.length > 0) {
        this.secrets.add(value);
      }
    }
  }

  emit(phase: string, status: AttemptEvent['status'], detail: string): void {
    if (this.closed) {
      return;
    }
    // Bound repeated startup observations, but always retain phase transitions.
    if (status === 'info' && this.events.length >= 200) {
      this.dropped++;
      return;
    }
    let sanitized = detail;
    for (const value of [...this.secrets].sort((a, b) => b.length - a.length)) {
      sanitized = sanitized.replaceAll(value, '[REDACTED]');
    }
    const event = {
      schemaVersion: 1,
      sequence: this.events.length + 1,
      elapsedMs: Date.now() - this.started,
      phase,
      status,
      detail: reportText(sanitized),
    } satisfies AttemptEvent;
    this.events.push(event);
    this.pending = this.pending
      .then(async () => {
        await this.testInfo.attach(progressAttachment, {
          contentType: 'application/json',
          body: JSON.stringify(event),
        });
      })
      .catch((error: unknown) => {
        this.attachmentFailure = error;
      });
  }

  async flush(): Promise<void> {
    await this.pending;
    if (this.attachmentFailure !== null) {
      throw new Error('Blackbox progress attachment failed', { cause: this.attachmentFailure });
    }
  }

  async finish(): Promise<void> {
    const output = realpathSync(this.testInfo.outputPath());
    const path = relative(realpathSync(process.cwd()), output);
    this.emit('artifacts', 'info', path.startsWith('..') ? output : path);
    this.closed = true;
    await this.flush();
    await this.testInfo.attach(attemptAttachment, {
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 1,
        identity: this.identity,
        events: this.events,
        omittedObservations: this.dropped,
      }),
    });
  }
}
