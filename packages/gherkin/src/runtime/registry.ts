import { createHash } from 'node:crypto';

import { CucumberExpression, ParameterTypeRegistry } from '@cucumber/cucumber-expressions';

import type { StepLibrary } from './library.js';
import type { Capability, StepDefinition, StepResolution } from './step-types.js';

// Only the shared step library may build a vocabulary from definitions
// (dependency-cruiser rule gherkin-registry-is-library-only). Everything else
// receives a finished StepLibrary and can only resolve text against it.

export interface StepLibraryInput {
  readonly name: string;
  readonly version: string;
  readonly definitions: readonly StepDefinition[];
  readonly capabilities: readonly Capability[];
}

interface CompiledDefinition {
  readonly definition: StepDefinition;
  readonly expression: CucumberExpression;
}

function vocabularyHash(definitions: readonly StepDefinition[]): string {
  const vocabulary = definitions
    .map((definition) =>
      JSON.stringify([
        definition.expression,
        definition.kind,
        definition.argument,
        [...definition.fixtures].sort(),
        definition.requires,
        definition.credentialParameter,
        definition.deadlineParameter,
      ]),
    )
    .sort();
  return `sha256:${createHash('sha256').update(vocabulary.join('\n')).digest('hex')}`;
}

function compileDefinitions(definitions: readonly StepDefinition[]): readonly CompiledDefinition[] {
  const parameterTypes = new ParameterTypeRegistry();
  const seen = new Set<string>();
  return definitions.map((definition) => {
    if (seen.has(definition.expression)) {
      throw new Error(`Step library defines ${JSON.stringify(definition.expression)} twice`);
    }
    seen.add(definition.expression);
    return { definition, expression: new CucumberExpression(definition.expression, parameterTypes) };
  });
}

function resolveText(
  compiled: readonly CompiledDefinition[],
  offered: ReadonlySet<Capability>,
  text: string,
): StepResolution {
  const matches = compiled.flatMap((candidate) => {
    const args = candidate.expression.match(text);
    return args === null ? [] : [{ definition: candidate.definition, args }];
  });
  if (matches.length === 0) {
    return { status: 'undefined' };
  }
  if (matches.length > 1) {
    return {
      status: 'ambiguous',
      expressions: matches.map((match) => match.definition.expression),
    };
  }
  const [{ definition, args }] = matches;
  if (definition.requires !== null && !offered.has(definition.requires)) {
    return { status: 'unavailable', definition, capability: definition.requires };
  }
  return {
    status: 'resolved',
    definition,
    parameters: args.map((arg) => arg.getValue(null)),
  };
}

export function createStepLibrary(input: StepLibraryInput): StepLibrary {
  const compiled = compileDefinitions(input.definitions);
  const offered = new Set(input.capabilities);
  return Object.freeze({
    identity: Object.freeze({
      name: input.name,
      version: input.version,
      vocabularyHash: vocabularyHash(input.definitions),
    }),
    capabilities: Object.freeze([...offered].sort()),
    vocabulary: Object.freeze(input.definitions.map(({ run: _run, ...entry }) => Object.freeze(entry))),
    resolve: (text: string) => resolveText(compiled, offered, text),
  });
}
