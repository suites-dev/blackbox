import { AstBuilder, compile, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin';
import { IdGenerator, type GherkinDocument, type Pickle } from '@cucumber/messages';

export interface ParsedGherkin {
  readonly document: GherkinDocument;
  readonly pickles: readonly Pickle[];
}

/**
 * Parses standard Gherkin syntax, including its language directive, with
 * Cucumber's parser. Parsing does not approve tags or executable step text.
 * Pickles expand outlines and inherit Background steps and tags.
 * IDs are deterministic for the same source. Invalid syntax throws the
 * official parser error with its source position.
 */
export function parseGherkin(source: string, uri: string): ParsedGherkin {
  const newId = IdGenerator.incrementing();
  const document = new Parser(new AstBuilder(newId), new GherkinClassicTokenMatcher()).parse(
    source,
  );
  return { document, pickles: compile(document, uri, newId) };
}
