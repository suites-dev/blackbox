import { describe, expect, it } from 'vitest';

import { errorsOf, featureWith, SELECTED } from '../validation/testing/context.js';

// Requirement: validation accepts exactly @system:<id>, @sandbox:<profile>
// and @requirement:REQ-<n>; every other tag is an error naming the tag
// and its file:line:column (report §2.2, task 2.2).

const SCENARIO = [
  '  Scenario: probe',
  '    When the client sends GET "/health"',
  '    Then the response status is 200',
].join('\n');

const OUTLINE = [
  '  Scenario Outline: probe',
  '    When the client sends GET "<path>"',
  '    Then the response status is 200',
  '',
].join('\n');

const notAllowed = (location: string, tag: string) =>
  `features/probe.feature:${location}: tag "${tag}" is not allowed; only @system:<id>, @sandbox:<profile> and @requirement:REQ-<n> are accepted`;

// Runner-policy and verdict tags (playwright-bdd and Cucumber specials), free
// labels, the proof of concept's @flow:, and near misses of allowed namespaces.
const FORBIDDEN = [
  '@only',
  '@skip',
  '@fixme',
  '@fail',
  '@slow',
  '@retries:1',
  '@retries:3',
  '@timeout:1000',
  '@mode:serial',
  '@mode:parallel',
  '@mode:default',
  '@wip',
  '@smoke',
  '@flow:subscriptions',
  '@label:fast',
  '@System:subscription-system',
  '@system:',
  '@requirement',
];

describe('non-allowed tags are errors at every level', () => {
  it.each(FORBIDDEN)('rejects %s on a Scenario', (tag) => {
    expect(errorsOf(featureWith(SELECTED, `  ${tag}\n${SCENARIO}`))).toEqual([notAllowed('4:3', tag)]);
  });

  it.each(FORBIDDEN)('rejects %s on the Feature', (tag) => {
    expect(errorsOf(featureWith(`${SELECTED} ${tag}`, SCENARIO))).toEqual([
      notAllowed(`1:${SELECTED.length + 2}`, tag),
    ]);
  });

  it.each(FORBIDDEN)('rejects %s on a Rule', (tag) => {
    const body = `  ${tag}\n  Rule: grouped\n\n${SCENARIO.replaceAll('\n', '\n  ').replace(/^/u, '  ')}`;
    expect(errorsOf(featureWith(SELECTED, body))).toEqual([notAllowed('4:3', tag)]);
  });

  it.each(FORBIDDEN)('rejects %s on Examples', (tag) => {
    const body = `${OUTLINE}    ${tag}\n    Examples:\n      | path    |\n      | /health |`;
    expect(errorsOf(featureWith(SELECTED, body))).toEqual([notAllowed('7:5', tag)]);
  });
});

describe('allowed namespaces are restricted to their levels', () => {
  it.each(['@system:payment-mock', '@sandbox:default'])('rejects %s on a Scenario', (tag) => {
    const namespace = tag.slice(0, tag.indexOf(':') + 1);
    expect(errorsOf(featureWith(SELECTED, `  ${tag}\n${SCENARIO}`))).toEqual([
      `features/probe.feature:4:3: ${namespace} is not allowed on Scenario (allowed on Feature)`,
    ]);
  });

  it.each(['@system:payment-mock', '@sandbox:default'])('rejects %s on a Rule', (tag) => {
    const namespace = tag.slice(0, tag.indexOf(':') + 1);
    const body = `  ${tag}\n  Rule: grouped\n\n  ${SCENARIO.replaceAll('\n', '\n  ')}`;
    expect(errorsOf(featureWith(SELECTED, body))).toEqual([
      `features/probe.feature:4:3: ${namespace} is not allowed on Rule (allowed on Feature)`,
    ]);
  });

  it('rejects a requirement ID on Examples', () => {
    const body = `${OUTLINE}    @requirement:REQ-7\n    Examples:\n      | path    |\n      | /health |`;
    expect(errorsOf(featureWith(SELECTED, body))).toEqual([
      'features/probe.feature:7:5: @requirement: is not allowed on Examples (allowed on Feature, Rule, Scenario)',
    ]);
  });
});

describe('requirement IDs', () => {
  it.each(['REQ-x', 'REQ-', 'req-1', 'REQ-1x', 'REQ-1.2', 'REQ1', 'REQ--1'])('rejects malformed %s', (id) => {
    expect(errorsOf(featureWith(SELECTED, `  @requirement:${id}\n${SCENARIO}`))).toEqual([
      `features/probe.feature:4:3: requirement ID "${id}" must match REQ-<n>`,
    ]);
  });

  it('rejects a duplicate requirement tag on one node', () => {
    expect(
      errorsOf(featureWith(SELECTED, `  @requirement:REQ-1 @requirement:REQ-1\n${SCENARIO}`)),
    ).toEqual(['features/probe.feature:4:22: duplicate tag "@requirement:REQ-1"']);
  });

  it('accepts the same ID at Feature and Scenario level and at every allowed level', () => {
    const body = `  @requirement:REQ-2\n  Rule: grouped\n\n  @requirement:REQ-1 @requirement:REQ-3\n  ${SCENARIO.replaceAll('\n', '\n  ')}`;
    expect(errorsOf(featureWith(`${SELECTED}\n@requirement:REQ-1`, body))).toEqual([]);
  });
});
