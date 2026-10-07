import {
  PickleStepType,
  StepKeywordType,
  type Background,
  type FeatureChild,
  type Pickle,
  type PickleDocString,
  type Rule,
  type RuleChild,
  type Scenario,
  type Step,
  type Tag,
} from '@cucumber/messages';

import { at, type DiagnosticSink } from './diagnostics.js';
import type {
  ExampleRow,
  FeatureBackground,
  FeatureModel,
  FeatureRule,
  FeatureScenario,
  FeatureStep,
  StepArgument,
} from './model.js';
import { parseFeature } from './parse.js';
import { readTags } from './tags.js';

type DocStringLike = Pick<PickleDocString, 'content' | 'mediaType'>;

interface TableLike {
  readonly rows: readonly { readonly cells: readonly { readonly value: string }[] }[];
}

/** A Gherkin doc string or data table (AST or pickle) as plain data. */
function argumentOf(
  docString: DocStringLike | undefined,
  dataTable: TableLike | undefined,
): StepArgument {
  if (docString !== undefined) {
    return {
      kind: 'doc-string',
      content: docString.content,
      mediaType: docString.mediaType ?? null,
    };
  }
  if (dataTable !== undefined) {
    return {
      kind: 'data-table',
      rows: dataTable.rows.map((row) => row.cells.map((cell) => cell.value)),
    };
  }
  return { kind: 'none' };
}

const tagNames = (tags: readonly Tag[]): readonly string[] => tags.map((tag) => tag.name);

function backgroundOf(children: readonly (FeatureChild | RuleChild)[]): Background | undefined {
  return children.flatMap((child) => (child.background === undefined ? [] : [child.background]))[0];
}

function scenariosOf(children: readonly (FeatureChild | RuleChild)[]): readonly Scenario[] {
  return children.flatMap((child) => (child.scenario === undefined ? [] : [child.scenario]));
}

/** The title an emitted test gets: the name, plus the row's values for an Examples row. */
function fullTitle(scenario: FeatureScenario): string {
  if (scenario.example === null) {
    return scenario.title;
  }
  return `${scenario.title} [${scenario.example.values.map((cell) => `${cell.name}=${cell.value}`).join(', ')}]`;
}

/** Walks one parsed feature into plain data, reporting structure and tag errors on the way. */
class FeatureReader {
  readonly #sink: DiagnosticSink;
  readonly #pickles = new Map<string, Pickle[]>();
  readonly #steps = new Map<string, Step>();
  readonly #backgroundSteps = new Set<string>();
  readonly #rows = new Map<
    string,
    { readonly row: ExampleRow; readonly tags: readonly string[] }
  >();

  constructor(sink: DiagnosticSink, pickles: readonly Pickle[]) {
    this.#sink = sink;
    for (const pickle of pickles) {
      const list = this.#pickles.get(pickle.astNodeIds[0]) ?? [];
      list.push(pickle);
      this.#pickles.set(pickle.astNodeIds[0], list);
    }
  }

  background(node: Background | undefined): FeatureBackground | null {
    if (node === undefined) {
      return null;
    }
    let outcome = false;
    const steps = node.steps.map((step) => {
      this.#backgroundSteps.add(step.id);
      outcome =
        step.keywordType === StepKeywordType.CONJUNCTION
          ? outcome
          : step.keywordType === StepKeywordType.OUTCOME;
      return {
        ...at(step.location),
        keyword: step.keyword.trim(),
        outcome,
        text: step.text,
        argument: argumentOf(step.docString, step.dataTable),
      };
    });
    return { ...at(node.location), steps };
  }

  scenarios(nodes: readonly Scenario[]): readonly FeatureScenario[] {
    const scenarios = nodes.flatMap((node) => this.#scenario(node));
    const first = new Map<string, FeatureScenario>();
    for (const scenario of scenarios) {
      const where = scenario.example ?? scenario;
      const earlier = first.get(fullTitle(scenario));
      if (earlier === undefined) {
        first.set(fullTitle(scenario), scenario);
      } else {
        const line = earlier.example === null ? earlier.line : earlier.example.line;
        this.#sink.report(
          'structure',
          where,
          `duplicate title "${fullTitle(scenario)}" (also at line ${line}); emitted tests need unique titles`,
        );
      }
    }
    return scenarios;
  }

  rule(node: Rule): FeatureRule {
    readTags(node.tags, 'Rule', this.#sink);
    const background = this.background(backgroundOf(node.children));
    const scenarios = this.scenarios(scenariosOf(node.children));
    return {
      ...at(node.location),
      title: node.name,
      tags: tagNames(node.tags),
      background,
      scenarios,
    };
  }

  #scenario(node: Scenario): readonly FeatureScenario[] {
    readTags(node.tags, 'Scenario', this.#sink);
    for (const examples of node.examples) {
      readTags(examples.tags, 'Examples', this.#sink);
      const header =
        examples.tableHeader === undefined
          ? []
          : examples.tableHeader.cells.map((cell) => cell.value);
      for (const row of examples.tableBody) {
        const values = row.cells.map((cell, index) => ({ name: header[index], value: cell.value }));
        this.#rows.set(row.id, {
          row: { ...at(row.location), values },
          tags: tagNames(examples.tags),
        });
      }
    }
    for (const step of node.steps) {
      this.#steps.set(step.id, step);
    }
    const location = at(node.location);
    const pickles = this.#pickles.get(node.id) ?? [];
    if (pickles.length === 0) {
      this.#sink.report(
        'structure',
        location,
        `"${node.keyword}: ${node.name}" has no Examples rows and would yield no test`,
      );
    } else if (node.steps.length === 0) {
      this.#sink.report('structure', location, `"${node.keyword}: ${node.name}" has no steps`);
    }
    return pickles.map((pickle) => {
      const row = pickle.astNodeIds
        .slice(1)
        .map((id) => this.#rows.get(id))
        .find((value) => value !== undefined);
      return {
        ...location,
        title: pickle.name,
        tags: [...tagNames(node.tags), ...(row === undefined ? [] : row.tags)],
        example: row === undefined ? null : row.row,
        steps: this.#pickleSteps(pickle),
      };
    });
  }

  #pickleSteps(pickle: Pickle): readonly FeatureStep[] {
    return pickle.steps
      .filter((step) => !this.#backgroundSteps.has(step.astNodeIds[0]))
      .map((step) => {
        const ast = this.#steps.get(step.astNodeIds[0]);
        if (ast === undefined) {
          throw new Error(`Gherkin pickle step ${step.id} has no AST step`);
        }
        const argument =
          step.argument === undefined
            ? argumentOf(undefined, undefined)
            : argumentOf(step.argument.docString, step.argument.dataTable);
        return {
          ...at(ast.location),
          keyword: ast.keyword.trim(),
          outcome: step.type === PickleStepType.OUTCOME,
          text: step.text,
          argument,
        };
      });
  }
}

/**
 * Parses one `.feature` source with the official Cucumber parser and reads it
 * into plain data. Reports parse, tag and structure errors to `sink`; returns
 * null when there is no Feature to read.
 */
export function readFeature(
  source: string,
  file: string,
  sink: DiagnosticSink,
): FeatureModel | null {
  const parsed = parseFeature(source, file, sink);
  if (parsed === null) {
    return null;
  }
  const feature = parsed.document.feature;
  if (feature === undefined) {
    sink.report('parse', { line: 1, column: 1 }, 'the file declares no Feature');
    return null;
  }
  const reader = new FeatureReader(sink, parsed.pickles);
  const selection = readTags(feature.tags, 'Feature', sink);
  const background = reader.background(backgroundOf(feature.children));
  const scenarios = reader.scenarios(scenariosOf(feature.children));
  const rules = feature.children.flatMap((child) =>
    child.rule === undefined ? [] : [reader.rule(child.rule)],
  );
  const declared = feature.children.flatMap((child) =>
    child.rule === undefined ? [child] : child.rule.children,
  );
  if (scenariosOf(declared).length === 0) {
    sink.report(
      'structure',
      at(feature.location),
      `"Feature: ${feature.name}" declares no scenario`,
    );
  }
  const titles = new Map<string, FeatureRule>();
  for (const rule of rules) {
    const earlier = titles.get(rule.title);
    if (earlier !== undefined) {
      sink.report(
        'structure',
        rule,
        `duplicate title "Rule: ${rule.title}" (also at line ${earlier.line}); emitted tests need unique titles`,
      );
    }
    titles.set(rule.title, earlier ?? rule);
  }
  return {
    ...at(feature.location),
    file,
    title: feature.name,
    tags: tagNames(feature.tags),
    selection,
    background,
    scenarios,
    rules,
  };
}
