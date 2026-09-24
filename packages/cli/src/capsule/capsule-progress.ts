import type { CapsuleProgressEvent } from '@suites/blackbox-capsule-internal';
import { progressDetail } from './capsule-progress-details.js';
import { InteractiveProgressRenderer } from '../progress/interactive-renderer.js';
import { terminalText } from '../progress/terminal-text.js';

export type CapsuleProgressPresentation = 'interactive' | 'plain' | 'silent';
export interface CapsuleProgressRendererInput {
  readonly presentation: CapsuleProgressPresentation;
  readonly color: boolean;
  readonly write: (text: string) => void;
}
export interface CapsuleProgressRenderer {
  readonly sink: (event: CapsuleProgressEvent) => void;
  readonly finish: () => void;
}

export function createCapsuleProgressRenderer(
  input: CapsuleProgressRendererInput,
): CapsuleProgressRenderer {
  if (input.presentation === 'silent') {
    return { sink: () => undefined, finish: () => undefined };
  }
  if (input.presentation === 'plain') {
    return {
      sink: (event) => {
        const indent = isAcquisitionDetail(event) ? '  ' : '';
        input.write(`${indent}[${event.sequence}] ${terminalText(progressDetail(event))}\n`);
      },
      finish: () => undefined,
    };
  }
  const renderer = new InteractiveProgressRenderer({
    color: input.color,
    write: input.write,
    now: Date.now,
    viewport: () => ({ columns: process.stderr.columns || 80, rows: process.stderr.rows || 24 }),
  });
  return {
    sink: (event) => {
      renderer.sink(event);
    },
    finish: () => {
      renderer.finish();
    },
  };
}
function isAcquisitionDetail(event: CapsuleProgressEvent): boolean {
  return [
    'acquisition-observation',
    'container-acquired',
    'endpoint-mapped',
    'resource-owned',
  ].includes(event.kind);
}
