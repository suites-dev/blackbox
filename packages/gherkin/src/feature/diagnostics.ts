import type { Location } from '@cucumber/messages';

export interface SourceLocation {
  readonly line: number;
  readonly column: number;
}

/** What kind of rule an error breaks, so a caller can tell them apart without parsing messages. */
export type ValidationErrorCode =
  | 'parse'
  | 'tag'
  | 'selection'
  | 'structure'
  | 'undefined-sentence'
  | 'ambiguous-sentence'
  | 'argument'
  | 'capability'
  | 'barrier'
  | 'then'
  | 'no-features'
  | 'runner-import'
  | 'library-copy';

/** One validation error at a file position. `file` is relative to the project directory, with `/` separators. */
export interface ValidationError extends SourceLocation {
  readonly code: ValidationErrorCode;
  readonly file: string;
  readonly message: string;
}

/** `file:line:column: message`, the form every error is printed in. */
export function formatValidationError(error: ValidationError): string {
  return `${error.file}:${error.line}:${error.column}: ${error.message}`;
}

/** Errors in source order: by file, then line, then column. */
export function sortErrors(errors: readonly ValidationError[]): readonly ValidationError[] {
  return [...errors].sort(
    (left, right) =>
      (left.file < right.file ? -1 : left.file > right.file ? 1 : 0) ||
      left.line - right.line ||
      left.column - right.column,
  );
}

/** A feature that does not parse, or a feature that `outline` was asked to describe without validating it first. */
export class InvalidFeatureError extends Error {
  readonly errors: readonly ValidationError[];

  constructor(errors: readonly ValidationError[]) {
    super(errors.map(formatValidationError).join('\n'));
    this.name = 'InvalidFeatureError';
    this.errors = errors;
  }
}

/**
 * Collects every error of one feature, so an author sees all problems at once.
 * Outline rows repeat their steps; the same message at the same position is
 * kept once.
 */
export class DiagnosticSink {
  readonly #file: string;
  readonly #errors = new Map<string, ValidationError>();

  constructor(file: string) {
    this.#file = file;
  }

  report(code: ValidationErrorCode, location: SourceLocation, message: string): void {
    const error = { code, file: this.#file, line: location.line, column: location.column, message };
    this.#errors.set(formatValidationError(error), error);
  }

  get errors(): readonly ValidationError[] {
    return sortErrors([...this.#errors.values()]);
  }
}

/** Gherkin omits the column on some positions, such as end of file. */
export function at(location: Location): SourceLocation {
  return { line: location.line, column: location.column ?? 1 };
}
