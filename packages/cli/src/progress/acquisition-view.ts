import type {
  CapsuleAcquisitionObservation,
  CapsuleProgressEvent,
} from '@suites/blackbox-capsule-internal';
import { observationDetail, progressDetail } from '../capsule/capsule-progress-details.js';
import type { TerminalLine } from './terminal-block.js';

interface ProgressRow {
  readonly kind: 'pending' | 'done' | 'failed' | 'info';
  readonly text: string;
}
type Completion =
  | { readonly kind: 'pending' }
  | { readonly kind: 'ready'; readonly durationMs: number }
  | { readonly kind: 'failed'; readonly stage: string; readonly reason: string }
  | { readonly kind: 'interrupted' };
const SPINNER = ['⠋', '⠙', '⠹', '⠸'];

export class AcquisitionView {
  private readonly rows = new Map<string, ProgressRow>();
  private completion: Completion = { kind: 'pending' };
  private stage = 'Starting capsule';
  private elapsedMs = 0;
  private observationStatus: 'not-reported' | 'available' | 'unavailable' = 'not-reported';

  get complete(): boolean {
    return this.completion.kind !== 'pending';
  }

  update(event: CapsuleProgressEvent): void {
    switch (event.kind) {
      case 'session-admitted':
        this.rows.set('session', {
          kind: 'done',
          text: `Session — ${event.sessionId} (${event.system})`,
        });
        break;
      case 'manager-spawned':
        this.rows.set('manager', { kind: 'pending', text: 'Manager — starting' });
        break;
      case 'manager-ready':
        this.rows.set('manager', { kind: 'done', text: 'Manager — ready' });
        break;
      case 'catalog-selected':
        this.rows.set('catalog', { kind: 'pending', text: `Catalog — loading ${event.system}` });
        break;
      case 'catalog-resolved':
        this.rows.set('catalog', { kind: 'done', text: `Catalog — ${event.system}` });
        for (const service of event.services) {
          this.rows.set(`service:${service}`, {
            kind: 'pending',
            text: `${service} — awaiting container`,
          });
        }
        break;
      case 'compose-configured':
        this.rows.set('compose', { kind: 'done', text: 'Compose — configured' });
        break;
      case 'acquisition-started':
        this.stage = 'Acquiring capsule';
        break;
      case 'acquisition-observation':
        this.stage = 'Acquiring capsule';
        this.observe(event.observation);
        break;
      case 'container-acquired':
        this.acquired(event);
        break;
      case 'resource-owned':
        this.rows.set(`${event.resource.kind}:${event.resource.name}`, {
          kind: 'done',
          text: `${event.resource.kind} ${event.resource.name} — owned`,
        });
        break;
      case 'endpoint-mapped':
        this.rows.set('endpoint', { kind: 'done', text: `Entrypoint — ${event.endpoint.url}` });
        break;
      case 'readiness-started':
        this.stage = 'Checking application readiness';
        this.rows.set('acquisition', {
          kind: 'done',
          text: 'Acquisition — Testcontainers checks passed',
        });
        this.rows.set('readiness', {
          kind: 'pending',
          text: `Application readiness — checking ${event.url}`,
        });
        break;
      case 'readiness-succeeded':
        this.rows.set('readiness', {
          kind: 'done',
          text: `Application readiness — ready (${event.durationMs}ms)`,
        });
        break;
      case 'capsule-ready':
        this.completion = { kind: 'ready', durationMs: event.durationMs };
        break;
      case 'capsule-start-failed':
        this.completion = { kind: 'failed', stage: event.stage, reason: progressDetail(event) };
        break;
    }
  }

  interrupt(): void {
    if (!this.complete) {
      this.completion = { kind: 'interrupted' };
    }
  }

  lines(input: { readonly frame: number; readonly elapsedMs: number }): readonly TerminalLine[] {
    const spinner = SPINNER[input.frame % SPINNER.length];
    const elapsed = Math.floor(Math.max(input.elapsedMs, this.elapsedMs) / 1000);
    const lines = [this.header({ spinner, elapsed })] satisfies TerminalLine[];
    if (this.completion.kind === 'failed') {
      lines.push({ tone: 'failure', text: `  ${this.completion.reason}` });
    }
    if (this.observationStatus === 'unavailable') {
      lines.push({
        tone: 'failure',
        text: '  ! Docker progress unavailable; latest states may be stale',
      });
    }
    if (this.observationStatus === 'available') {
      lines.push({ tone: 'neutral', text: '  • Docker progress observation resumed' });
    }
    // Stable insertion order keeps each resource on the same row as its state changes.
    for (const row of this.rows.values()) {
      const marker =
        row.kind === 'done'
          ? '✓'
          : row.kind === 'failed'
            ? '✗'
            : row.kind === 'pending' && !this.complete
              ? spinner
              : '•';
      lines.push({
        tone: row.kind === 'failed' ? 'failure' : row.kind === 'done' ? 'success' : 'neutral',
        text: `  ${marker} ${row.text}`,
      });
    }
    return lines;
  }

  private header(input: { readonly spinner: string; readonly elapsed: number }): TerminalLine {
    switch (this.completion.kind) {
      case 'pending':
        return {
          tone: 'active',
          text: `${input.spinner} ${this.stage}… · ${input.elapsed}s elapsed`,
        };
      case 'ready':
        return { tone: 'success', text: `✓ Capsule ready · ${this.completion.durationMs}ms` };
      case 'failed':
        return { tone: 'failure', text: `✗ Capsule start failed — ${this.completion.stage}` };
      case 'interrupted':
        return { tone: 'neutral', text: '• Startup observation ended before Capsule readiness' };
    }
  }

  private acquired(event: Extract<CapsuleProgressEvent, { kind: 'container-acquired' }>): void {
    const key = `service:${event.service}`;
    const previous = this.rows.get(key);
    const detail =
      previous !== undefined && previous.text.includes('healthy (Docker)')
        ? 'healthy (Docker); Testcontainers checks passed'
        : 'Testcontainers checks passed';
    this.rows.set(key, { kind: 'done', text: `${event.participant} — ${detail}` });
  }

  private observe(observation: CapsuleAcquisitionObservation): void {
    switch (observation.kind) {
      case 'waiting':
        this.elapsedMs = observation.elapsedMs;
        break;
      case 'observation-status':
        this.observationStatus = observation.status;
        break;
      case 'resource-discovered':
        this.rows.set(`${observation.resource.kind}:${observation.resource.name}`, {
          kind: 'done',
          text: `${observation.resource.kind} ${observation.resource.name} — available`,
        });
        break;
      case 'service-state': {
        const { container, participant } = observation;
        const failed =
          container.state === 'exited' ||
          container.state === 'dead' ||
          container.health === 'unhealthy';
        const healthy = container.state === 'running' && container.health === 'healthy';
        const detail = healthy
          ? `${participant} — healthy (Docker)`
          : observationDetail(observation).replace(
              `${participant}: container `,
              `${participant} — `,
            );
        this.rows.set(`service:${container.service}`, {
          kind: failed ? 'failed' : healthy ? 'done' : 'pending',
          text: detail,
        });
        break;
      }
    }
  }
}
