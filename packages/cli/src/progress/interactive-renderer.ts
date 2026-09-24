import type { CapsuleProgressEvent } from '@suites/blackbox-capsule-internal';
import { AcquisitionView } from './acquisition-view.js';
import { TerminalBlock, type TerminalViewport } from './terminal-block.js';

export interface InteractiveRendererInput {
  readonly color: boolean;
  readonly write: (text: string) => void;
  readonly viewport: () => TerminalViewport;
  readonly now: () => number;
}

export class InteractiveProgressRenderer {
  private readonly block: TerminalBlock;
  private readonly view = new AcquisitionView();
  private timer: { readonly kind: 'idle' } | { readonly kind: 'running'; handle: NodeJS.Timeout } =
    {
      kind: 'idle',
    };
  private frame = 0;
  private finished = false;
  private received = false;
  private readonly started: number;
  constructor(private readonly input: InteractiveRendererInput) {
    this.block = new TerminalBlock(input);
    this.started = input.now();
  }

  sink(event: CapsuleProgressEvent): void {
    if (this.finished) {
      return;
    }
    this.received = true;
    this.view.update(event);
    this.draw();
    if (this.view.complete) {
      this.finish();
      return;
    }
    if (this.timer.kind === 'idle') {
      const handle = setInterval(() => {
        this.draw();
      }, 100);
      handle.unref();
      this.timer = { kind: 'running', handle };
    }
  }

  finish(): void {
    if (this.finished) {
      return;
    }
    if (this.timer.kind === 'running') {
      clearInterval(this.timer.handle);
      this.timer = { kind: 'idle' };
    }
    if (this.received && !this.view.complete) {
      this.view.interrupt();
      this.draw();
    }
    this.block.finish();
    this.finished = true;
  }

  private draw(): void {
    this.block.render({
      lines: this.view.lines({
        frame: this.frame++,
        elapsedMs: Math.max(0, this.input.now() - this.started),
      }),
    });
  }
}
