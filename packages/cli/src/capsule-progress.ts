import type { CapsuleProgressEvent } from '@suites/blackbox-capsule-internal';
import { progressDetail, progressMarker } from './capsule-progress-details.js';

export type CapsuleProgressPresentation = 'interactive' | 'plain' | 'silent';
export interface CapsuleProgressRendererInput { readonly presentation: CapsuleProgressPresentation; readonly color: boolean; readonly write: (text: string) => void }
export interface CapsuleProgressRenderer { readonly sink: (event: CapsuleProgressEvent) => void; readonly finish: () => void }
const SPINNER = ['⠋', '⠙', '⠹', '⠸'];

export function createCapsuleProgressRenderer(input: CapsuleProgressRendererInput): CapsuleProgressRenderer {
  const renderer = new ProgressRenderer(input);
  return { sink: (event) => { renderer.sink(event); }, finish: () => { renderer.finish(); } };
}

class ProgressRenderer {
  private frame = 0;
  private timer: NodeJS.Timeout | undefined;
  private stage = '';
  private text = '';
  private startedAt = Date.now();
  private width = 0;
  private pending = false;

  constructor(private readonly input: CapsuleProgressRendererInput) {}

  sink(event: CapsuleProgressEvent): void {
    if (this.input.presentation === 'silent') { return; }
    const text = progressDetail(event);
    if (this.input.presentation === 'plain') { this.input.write(`[${event.sequence}] ${text}\n`); return; }
    if ((event.kind === 'readiness-started' || event.kind === 'capsule-ready') && this.stage === 'acquisition') {
      this.line('✓', 'Acquisition complete: Testcontainers checks passed');
    }
    if (this.stage !== event.stage) { this.startedAt = Date.now(); }
    this.stage = event.stage;
    this.text = this.interactiveDetail(event, text);
    if (event.kind === 'capsule-start-failed' || event.kind === 'capsule-ready') {
      this.stopTimer(); this.line(progressMarker(event), `${labelFor(event.stage)} (${text})`); this.pending = false; return;
    }
    const marker = progressMarker(event);
    const observation = event.kind === 'acquisition-observation';
    if (marker !== '…' && !(observation && event.observation.kind === 'waiting')) {
      this.line(marker, this.text);
    }
    this.pending = true;
    // Resource updates remain visible above a stable acquisition spinner.
    if (event.stage === 'acquisition') { this.text = 'starting resources; waiting for Testcontainers checks'; }
    this.draw();
    if (this.timer === undefined) { this.timer = setInterval(() => { this.draw(); }, 100); this.timer.unref(); }
  }

  finish(): void {
    this.stopTimer();
    if (this.input.presentation === 'interactive' && this.pending) { this.input.write(`${this.clearLine()}\n`); }
    this.pending = false;
  }

  private interactiveDetail(event: CapsuleProgressEvent, text: string): string {
    if (event.kind === 'compose-configured') { return 'Compose configuration prepared'; }
    if (event.kind === 'container-acquired') { return `${event.participant}: Testcontainers checks passed`; }
    return text;
  }
  private draw(): void {
    const elapsed = Math.floor((Date.now() - this.startedAt) / 1000);
    const text = `${labelFor(this.stage)}... ${this.text} · ${elapsed}s elapsed`;
    this.input.write(`${this.clearLine()}${this.paint(SPINNER[this.frame++ % SPINNER.length])} ${text}`);
    this.width = text.length + 2;
  }
  private line(marker: string, text: string): void { this.input.write(`${this.clearLine()}${this.paint(marker)} ${text}\n`); this.width = 0; }
  private clearLine(): string { return this.input.color ? '\r\u001b[2K' : `\r${' '.repeat(this.width)}\r`; }
  private paint(text: string): string { return this.input.color ? `\u001b[36m${text}\u001b[0m` : text; }
  private stopTimer(): void { if (this.timer !== undefined) { clearInterval(this.timer); this.timer = undefined; } }
}
function labelFor(stage: string): string { return stage.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
