import { EMIT_COMMAND } from '../render/render.js';

// What drift reports. Each finding names one fix: either the emit command,
// which writes what the suite is missing, or the suite line to edit by hand.

export type DriftKind =
  | 'scenario-missing'
  | 'extra-test'
  | 'step-missing'
  | 'step-extra'
  | 'step-out-of-order'
  | 'changed-value'
  | 'edited-library-call';

/** Run the emit command: it writes the scenarios and steps the suite is missing. */
export interface EmitFix {
  readonly kind: 'emit';
  readonly text: string;
}

/** Edit the suite by hand at this line. */
export interface EditFix {
  readonly kind: 'edit';
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export type DriftFix = EmitFix | EditFix;

export interface DriftFinding {
  readonly kind: DriftKind;
  /** The scenario title the finding is about. */
  readonly scenario: string;
  readonly message: string;
  readonly fix: DriftFix;
}

export const emitFix: EmitFix = Object.freeze({ kind: 'emit', text: `run \`${EMIT_COMMAND}\`` });

export function editFix(file: string, line: number): EditFix {
  return { kind: 'edit', file, line, text: `fix the suite at ${file}:${line}` };
}
