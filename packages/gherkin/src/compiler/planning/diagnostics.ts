import type { Location } from '@cucumber/messages';

export interface SourceLocation {
  readonly line: number;
  readonly column: number;
}

/** A compile error at a `.feature` position. Every diagnostic names file:line:column. */
export interface Diagnostic extends SourceLocation {
  readonly file: string;
  readonly message: string;
}

export function formatDiagnostic(diagnostic: Diagnostic): string {
  return `${diagnostic.file}:${diagnostic.line}:${diagnostic.column}: ${diagnostic.message}`;
}

export class FeatureCompileError extends Error {
  readonly diagnostics: readonly Diagnostic[];

  constructor(diagnostics: readonly Diagnostic[]) {
    super(diagnostics.map(formatDiagnostic).join('\n'));
    this.name = 'FeatureCompileError';
    this.diagnostics = diagnostics;
  }
}

/**
 * Collects every diagnostic of one feature before anything is emitted, so an
 * author sees all problems at once. Outline rows repeat their steps; the same
 * message at the same position is reported once.
 */
export class DiagnosticSink {
  readonly #file: string;
  readonly #diagnostics = new Map<string, Diagnostic>();

  constructor(file: string) {
    this.#file = file;
  }

  report(location: SourceLocation, message: string): void {
    const diagnostic = { file: this.#file, line: location.line, column: location.column, message };
    this.#diagnostics.set(formatDiagnostic(diagnostic), diagnostic);
  }

  /** Throws the collected diagnostics; callers use it where a diagnostic was already reported. */
  fail(): never {
    this.throwIfAny();
    throw new Error(`${this.#file}: compile failed without a diagnostic`);
  }

  throwIfAny(): void {
    if (this.#diagnostics.size > 0) {
      throw new FeatureCompileError(
        [...this.#diagnostics.values()].sort(
          (left, right) => left.line - right.line || left.column - right.column,
        ),
      );
    }
  }
}

/** Gherkin omits the column on some positions, such as end of file. */
export function at(location: Location): SourceLocation {
  return { line: location.line, column: location.column ?? 1 };
}
