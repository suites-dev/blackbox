import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DiagnosticSink, InvalidFeatureError } from '../feature/diagnostics.js';
import type { FeatureBackground, FeatureScenario, FeatureStep } from '../feature/model.js';
import { readFeature } from '../feature/read.js';
import type { GherkinProject } from '../project/config.js';
import { acceptedFeatures, projectFiles } from '../project/files.js';
import { sentenceMatcher, type SentenceMatcher } from '../sentences/match.js';
import type { SentenceList } from '../sentences/model.js';
import type { FeatureOutline, OutlineBackground, OutlineScenario, OutlineStep } from './model.js';

function outlineStep(step: FeatureStep, match: SentenceMatcher): OutlineStep {
  const matched = match(step.text);
  return {
    line: step.line,
    column: step.column,
    keyword: step.keyword,
    text: step.text,
    sentence: matched.status === 'matched' ? matched.sentence.expression : null,
    values: matched.status === 'matched' ? matched.values : [],
    argument: step.argument,
  };
}

function outlineBackground(
  background: FeatureBackground | null,
  match: SentenceMatcher,
): OutlineBackground | null {
  return background === null
    ? null
    : {
        line: background.line,
        column: background.column,
        steps: background.steps.map((step) => outlineStep(step, match)),
      };
}

function outlineScenario(scenario: FeatureScenario, match: SentenceMatcher): OutlineScenario {
  return { ...scenario, steps: scenario.steps.map((step) => outlineStep(step, match)) };
}

/**
 * The outline of one `.feature` source. It needs a feature that parses and
 * declares a Feature, and throws InvalidFeatureError otherwise; every other
 * rule is `validate`'s, so run that first.
 */
export function outlineFeature(
  source: string,
  file: string,
  sentences: SentenceList,
): FeatureOutline {
  return outlineWith(source, file, sentenceMatcher(sentences));
}

function outlineWith(source: string, file: string, match: SentenceMatcher): FeatureOutline {
  const sink = new DiagnosticSink(file);
  const feature = readFeature(source, file, sink);
  if (feature === null) {
    throw new InvalidFeatureError(sink.errors);
  }
  return {
    line: feature.line,
    column: feature.column,
    file,
    title: feature.title,
    tags: feature.tags,
    background: outlineBackground(feature.background, match),
    scenarios: feature.scenarios.map((scenario) => outlineScenario(scenario, match)),
    rules: feature.rules.map((rule) => ({
      ...rule,
      background: outlineBackground(rule.background, match),
      scenarios: rule.scenarios.map((scenario) => outlineScenario(scenario, match)),
    })),
  };
}

/** The outline of every accepted feature of a project, in path order. It writes nothing. */
export async function outline(
  project: GherkinProject,
  sentences: SentenceList,
): Promise<readonly FeatureOutline[]> {
  const match = sentenceMatcher(sentences);
  const features = acceptedFeatures(await projectFiles(project.root), project);
  const outlines: FeatureOutline[] = [];
  for (const file of features) {
    outlines.push(outlineWith(await readFile(join(project.root, file), 'utf8'), file, match));
  }
  return outlines;
}
