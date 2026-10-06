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

/** Freezes a value and everything reachable through its own properties, functions included. */
function deepFreeze(value: unknown, seen = new WeakSet()): void {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
    return;
  }
  if (seen.has(value)) {
    return;
  }
  seen.add(value);
  Object.freeze(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key], seen);
  }
}

/**
 * Deep-freezes step definitions where they are declared, body included, so no
 * module loaded into the run (a Playwright config, a global setup or a
 * fixture) can replace a reviewed step body (hard rule 3). A replacement
 * throws a TypeError in strict-mode code, which every ES module is.
 */
export function stepDefinitions(definitions: readonly StepDefinition[]): readonly StepDefinition[] {
  deepFreeze(definitions);
  return definitions;
}

/**
 * Identifies the library by its definitions in any order: each one's
 * expression, kind, argument, fixtures, capability, parameter roles, body
 * source and compile-time check source. A body that differs from the compiled
 * one changes the hash the compile manifest records.
 */
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
        definition.run.toString(),
        ...(definition.check === null ? [] : [definition.check.toString()]),
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
  stepDefinitions(input.definitions);
  const compiled = compileDefinitions(input.definitions);
  const offered = new Set(input.capabilities);
  return Object.freeze({
    identity: Object.freeze({
      name: input.name,
      version: input.version,
      vocabularyHash: vocabularyHash(input.definitions),
    }),
    capabilities: Object.freeze([...offered].sort()),
    vocabulary: Object.freeze(input.definitions.map(({ run: _run, check: _check, ...entry }) => Object.freeze(entry))),
    resolve: (text: string) => resolveText(compiled, offered, text),
  });
}
