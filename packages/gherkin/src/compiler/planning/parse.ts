import {
  AstBuilder,
  compile,
  Errors,
  GherkinClassicTokenMatcher,
  Parser,
} from '@cucumber/gherkin';
import { IdGenerator, type GherkinDocument, type Location, type Pickle } from '@cucumber/messages';

import { at, type DiagnosticSink, type SourceLocation } from './diagnostics.js';

export interface ParsedFeature {
  readonly document: GherkinDocument;
  readonly pickles: readonly Pickle[];
}

function parserErrors(error: unknown): readonly Error[] | null {
  if (error instanceof Errors.CompositeParserException) {
    return error.errors;
  }
  if (error instanceof Errors.GherkinException) {
    return [error];
  }
  return null;
}

// Gherkin reports an unknown position as line -1 or 0.
function positionOf(error: Error): SourceLocation {
  const location: Location | undefined =
    error instanceof Errors.GherkinException ? error.location : undefined;
  const { line, column } = at(location ?? { line: 1 });
  return { line: Math.max(line, 1), column: Math.max(column, 1) };
}

/**
 * Parses with the official Cucumber parser and builds pickles, the
 * per-scenario (and per-Examples-row) step lists. IDs are deterministic so the
 * same feature always compiles to the same output.
 */
export function parseFeature(source: string, file: string, sink: DiagnosticSink): ParsedFeature | null {
  const newId = IdGenerator.incrementing();
  let document: GherkinDocument;
  try {
    document = new Parser(new AstBuilder(newId), new GherkinClassicTokenMatcher()).parse(source);
  } catch (error) {
    const errors = parserErrors(error);
    if (errors === null) {
      throw error;
    }
    for (const parseError of errors) {
      sink.report(positionOf(parseError), parseError.message.replace(/^\(\d+:\d+\): /u, ''));
    }
    return null;
  }
  return { document, pickles: compile(document, file, newId) };
}
