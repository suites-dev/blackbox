import type { Background, FeatureChild, Pickle, Rule, Scenario, Step } from '@cucumber/messages';

import { at, DiagnosticSink, type SourceLocation } from './diagnostics.js';
import type {
  CompileContext,
  FeaturePlan,
  PlannedBackground,
  PlannedRule,
  PlannedScenario,
  PlannedStep,
} from './model.js';
import { parseFeature } from './parse.js';
import { selectBoundary } from './selection.js';
import { checkScenario, planStep, stepArgument, type StepScope, type StepSource } from './steps.js';
import { readTags, unionRequirements } from './tags.js';

interface Scope {
  readonly requirements: readonly string[];
  /** Background steps that run before this scope's scenarios, outermost first. */
  readonly background: readonly PlannedStep[];
  readonly backgroundIds: ReadonlySet<string>;
}

interface Titled extends SourceLocation {
  readonly title: string;
}

function reportDuplicateTitles(items: readonly Titled[], sink: DiagnosticSink): void {
  const first = new Map<string, Titled>();
  for (const item of items) {
    const earlier = first.get(item.title);
    if (earlier === undefined) {
      first.set(item.title, item);
    } else {
      sink.report(item, `duplicate title "${item.title}" (also at line ${earlier.line}); Playwright requires unique titles`);
    }
  }
}

function backgroundOf(children: readonly FeatureChild[]): Background | undefined {
  return children.flatMap((child) => (child.background === undefined ? [] : [child.background]))[0];
}

function scenariosOf(children: readonly FeatureChild[]): readonly Scenario[] {
  return children.flatMap((child) => (child.scenario === undefined ? [] : [child.scenario]));
}

class FeaturePlanner {
  readonly #file: string;
  readonly #scope: StepScope;
  readonly #sink: DiagnosticSink;
  readonly #picklesByScenario = new Map<string, Pickle[]>();
  readonly #astSteps = new Map<string, Step>();
  readonly #exampleRows = new Map<string, { readonly line: number; readonly label: string }>();

  constructor(file: string, scope: StepScope, sink: DiagnosticSink) {
    this.#file = file;
    this.#scope = scope;
    this.#sink = sink;
  }

  index(pickles: readonly Pickle[]): void {
    for (const pickle of pickles) {
      const list = this.#picklesByScenario.get(pickle.astNodeIds[0]) ?? [];
      list.push(pickle);
      this.#picklesByScenario.set(pickle.astNodeIds[0], list);
    }
  }

  background(node: Background | undefined, outer: Scope): { readonly plan: PlannedBackground | null; readonly scope: Scope } {
    if (node === undefined) {
      return { plan: null, scope: outer };
    }
    const steps = this.#steps(node.steps.map((step) => this.#astSource(step)));
    const ids = new Set([...outer.backgroundIds, ...node.steps.map((step) => step.id)]);
    return {
      plan: { ...at(node.location), steps },
      scope: { ...outer, background: [...outer.background, ...steps], backgroundIds: ids },
    };
  }

  scenarios(nodes: readonly Scenario[], scope: Scope): readonly PlannedScenario[] {
    const planned = nodes.flatMap((node) => this.#scenario(node, scope));
    reportDuplicateTitles(planned, this.#sink);
    return planned;
  }

  rule(node: Rule, outer: Scope): PlannedRule {
    const tags = readTags(node.tags, 'Rule', this.#sink);
    const background = this.background(backgroundOf(node.children), {
      ...outer,
      requirements: unionRequirements(outer.requirements, tags.requirement),
    });
    return {
      ...at(node.location),
      title: `Rule: ${node.name}`,
      background: background.plan,
      scenarios: this.scenarios(scenariosOf(node.children), background.scope),
    };
  }

  #scenario(node: Scenario, scope: Scope): readonly PlannedScenario[] {
    const requirements = unionRequirements(scope.requirements, readTags(node.tags, 'Scenario', this.#sink).requirement);
    for (const examples of node.examples) {
      readTags(examples.tags, 'Examples', this.#sink);
      const header = examples.tableHeader === undefined ? [] : examples.tableHeader.cells.map((cell) => cell.value);
      for (const row of examples.tableBody) {
        const label = row.cells.map((cell, index) => `${header[index]}=${cell.value}`).join(', ');
        this.#exampleRows.set(row.id, { line: row.location.line, label });
      }
    }
    for (const step of node.steps) {
      this.#astSteps.set(step.id, step);
    }
    const pickles = this.#picklesByScenario.get(node.id) ?? [];
    if (pickles.length === 0) {
      this.#sink.report(at(node.location), `"${node.keyword}: ${node.name}" has no Examples rows and would compile to no test`);
    }
    return pickles.map((pickle) => this.#pickle(pickle, node, { ...scope, requirements }));
  }

  #pickle(pickle: Pickle, node: Scenario, scope: Scope): PlannedScenario {
    const row = pickle.astNodeIds.slice(1).map((id) => this.#exampleRows.get(id)).find((value) => value !== undefined);
    const title = `Scenario: ${pickle.name}${row === undefined ? '' : ` [${row.label}]`}`;
    const sources = pickle.steps
      .filter((step) => !scope.backgroundIds.has(step.astNodeIds[0]))
      .map((step) => {
        const ast = this.#astSteps.get(step.astNodeIds[0]);
        if (ast === undefined) {
          throw new Error(`Gherkin pickle step ${step.id} has no AST step`);
        }
        const argument = step.argument === undefined ? stepArgument(undefined, undefined) : stepArgument(step.argument.docString, step.argument.dataTable);
        return { ...at(ast.location), keyword: ast.keyword.trim(), text: step.text, argument };
      });
    const steps = this.#steps(sources);
    const location = at(node.location);
    if (steps.length === sources.length && scope.background.length + steps.length > 0) {
      checkScenario({ ...location, title, background: scope.background, steps }, this.#sink);
    } else if (sources.length === 0) {
      this.#sink.report(location, `"${title}" has no steps`);
    }
    return {
      ...location,
      id: `${this.#file}:${location.line}${row === undefined ? '' : `:${row.line}`}`,
      title,
      exampleLine: row === undefined ? null : row.line,
      requirements: scope.requirements,
      steps,
    };
  }

  #astSource(step: Step): StepSource {
    return { ...at(step.location), keyword: step.keyword.trim(), text: step.text, argument: stepArgument(step.docString, step.dataTable) };
  }

  #steps(sources: readonly StepSource[]): readonly PlannedStep[] {
    return sources.flatMap((source) => {
      const planned = planStep(source, this.#scope, this.#sink);
      return planned === null ? [] : [planned];
    });
  }
}

/**
 * Parses one `.feature` source and validates everything the generated test
 * depends on: tags, selection, step resolution, capabilities and scenario
 * structure. Throws FeatureCompileError with every problem found.
 */
export function planFeature(source: string, file: string, context: CompileContext): FeaturePlan {
  const sink = new DiagnosticSink(file);
  const parsed = parseFeature(source, file, sink);
  if (parsed === null) {
    return sink.fail();
  }
  const feature = parsed.document.feature;
  if (feature === undefined) {
    sink.report({ line: 1, column: 1 }, 'the file declares no Feature');
    return sink.fail();
  }
  const tags = readTags(feature.tags, 'Feature', sink);
  const boundary = selectBoundary(tags, at(feature.location), context, sink);
  const profile =
    boundary === null ? null : { name: boundary.selection.sandbox, credentials: boundary.credentials };
  const planner = new FeaturePlanner(file, { library: context.library, profile }, sink);
  planner.index(parsed.pickles);
  const background = planner.background(backgroundOf(feature.children), {
    requirements: tags.requirement,
    background: [],
    backgroundIds: new Set(),
  });
  const scenarios = planner.scenarios(scenariosOf(feature.children), background.scope);
  const rules = feature.children.flatMap((child) => (child.rule === undefined ? [] : [planner.rule(child.rule, background.scope)]));
  reportDuplicateTitles(rules, sink);
  const declared = feature.children.filter((child) => child.scenario !== undefined).length +
    feature.children.reduce((count, child) => count + (child.rule === undefined ? 0 : scenariosOf(child.rule.children).length), 0);
  if (declared === 0) {
    sink.report(at(feature.location), `"Feature: ${feature.name}" declares no scenario`);
  }
  sink.throwIfAny();
  if (boundary === null) {
    return sink.fail();
  }
  return {
    ...at(feature.location),
    file,
    title: `Feature: ${feature.name}`,
    description: feature.description.trim(),
    ...boundary,
    background: background.plan,
    scenarios,
    rules,
  };
}
