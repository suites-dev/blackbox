import { describe, expect, it } from 'vitest';

import asyncRedisProof from './fixtures/async-redis-proof.feature.js';
import { catalog } from './fixtures/catalog.js';
import escapingAndDuplicateRows from './fixtures/escaping-and-duplicate-rows.feature.js';
import orderPricing from './fixtures/order-pricing.feature.js';
import subscriptionActivationE2E from './fixtures/subscription-activation-e2e.feature.js';
import subscriptionOutlineInterpolation from './fixtures/subscription-outline-interpolation.feature.js';
import { compileFeature } from '../src/index.js';
import { expectValidTypeScript, expectGeneratedCodeTypechecks, generatedCodeDiagnostics } from './support/generated-typecheck.fixture.js';

const clients = { api: { from: '../clients.js', export: 'api' } } as const;

describe('Feature compiler literal safety', () => {
  it('keeps generated literals safe without changing their runtime values', () => {
    const value = '</script> "quoted" \\path\n\u2028\u2029';
    const featureName = 'Escaping </script> "quoted" \\path';
    const source = [
      '@subsystem:orders',
      `Feature: ${featureName}`,
      '  Scenario: Send a literal value',
      '    When client "api" sends POST "/echo" with JSON:',
      '      """json',
      `      ${JSON.stringify({ value })}`,
      '      """',
      '    Then the response status is 200',
    ].join('\n');
    const result = compileFeature({ catalog, source, clients });

    expect(result.diagnostics).toEqual([]);
    expectValidTypeScript(result.code, 'safe-literals.generated.ts');
    expect(result.code).not.toContain('</script>');
    expect(result.code).toContain('\\u003C');
    const title = /test\.describe\(("Feature: (?:\\.|[^"\\])*")/u.exec(result.code);
    const body = /data: JSON\.parse\(("(?:\\.|[^"\\])*")\)/u.exec(result.code);
    if (!title || !body) {
      throw new Error('Generated suite is missing the title or JSON body.');
    }
    expect(JSON.parse(title[1])).toBe(`Feature: ${featureName}`);
    const serializedBody: unknown = JSON.parse(body[1]);
    expect(typeof serializedBody).toBe('string');
    if (typeof serializedBody !== 'string') {
      throw new Error('JSON body must be a serialized string.');
    }
    expect(JSON.parse(serializedBody)).toEqual({ value });
  });
});

describe('Feature compiler snapshots', () => {
  it('compiles hierarchy, backgrounds, tags, tables, doc strings, and outline rows', () => {
    const result = compileExample(orderPricing, 'order-pricing.feature');
    expect(result.diagnostics).toEqual([]);
    expect(result.code.match(/test\(/gu)).toHaveLength(2);
    expect(result.code).toContain("system: { kind: 'subsystem', id: \"orders\" }");
    expect(result.code).toContain('clients.api.');
    expect(result.code).not.toContain('clients.client_api.');
    expect(result.code).toContain('"quantity":0');
    expect(result.code).toContain('"quantity":2');
    expectValidTypeScript(result.code, 'order-pricing.generated.ts');
    expectGeneratedCodeTypechecks(result.code);
    expect(result.code).toMatchSnapshot();
  });

  it('compiles the E2E subscription Outline with placeholders embedded in JSON strings', () => {
    let result: ReturnType<typeof compileFeature> | undefined;
    expect(() => {
      result = compileExample(subscriptionOutlineInterpolation, 'subscription-activation.feature');
    }).not.toThrow();
    if (!result) {
      throw new Error('Feature compilation did not return a result.');
    }
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain(
      '"userId":"${JSON.stringify(String(row["userId"])).slice(1, -1)}"',
    );
    expect(result.code).toContain(
      'pm_${JSON.stringify(String(row["userId"])).slice(1, -1)}_unused',
    );
    expect(result.code).toContain(
      '"reg:${JSON.stringify(String(row["userId"])).slice(1, -1)}":"1"',
    );
    expect(result.code).not.toContain('pm_<userId>_unused');
    expect(result.code).not.toContain('reg:<userId>');
    expectValidTypeScript(result.code, 'subscription-outline-interpolation.generated.ts');
    expectGeneratedCodeTypechecks(result.code);
    expect(result.code).toMatchSnapshot();
  });

  it('compiles exact-state assertions in the full E2E Feature', () => {
    const result = compileExample(subscriptionActivationE2E, 'subscription-activation.feature');
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain('expect(await response.json()).toEqual(');
    expect(result.code).toContain('"reg:${JSON.stringify(String(row["userId"])).slice(1, -1)}"');
    expectValidTypeScript(result.code, 'subscription-activation.generated.ts');
    expectGeneratedCodeTypechecks(result.code);
    expect(result.code).toMatchSnapshot();
  });

  it('preserves escaping, And/But/* titles, multiple Act/Assert phases, and duplicate row identity', () => {
    const result = compileExample(escapingAndDuplicateRows, 'escaping-and-duplicate-rows.feature');
    expect(result.diagnostics).toEqual([]);
    expect(result.code.match(/test\(/gu)).toHaveLength(2);
    expect(result.code).toContain('${rowIndex + 1}');
    expect(result.code).not.toContain('__ROW_INDEX__');
    expect(result.code).not.toContain('"value": "<value>"');
    expect(result.code).toContain('Examples 1');
    expect(result.code).toContain('Examples 2');
    expect(result.code).toContain('clients.api.');
    expect(result.code).not.toContain('clients.client_api.');
    expect(result.code).toContain('"same"');
    expectValidTypeScript(result.code, 'escaping-and-duplicate-rows.generated.ts');
    expectGeneratedCodeTypechecks(result.code);
    expect(result.code).toMatchSnapshot();
  });
});

describe('Feature compiler diagnostics', () => {
  it('catches a lost response binding in the generated-code typecheck negative control', () => {
    const result = compileExample(orderPricing, 'order-pricing.feature');
    const reference = [...result.code.matchAll(/\bresponse\d+\b/gu)][1] as RegExpMatchArray & {
      index: number;
    };
    const wrongResponseBinding = `${result.code.slice(0, reference.index)}lostResponse${result.code.slice(reference.index + reference[0].length)}`;
    expect(wrongResponseBinding).not.toBe(result.code);
    expect(generatedCodeDiagnostics(wrongResponseBinding)).toEqual(
      expect.arrayContaining([expect.stringMatching(/Cannot find name 'response\d+'/u)]),
    );
  });

  it('rejects the natural-language async Redis feature without emitting a suite', () => {
    const result = compileExample(asyncRedisProof, 'redis-proof-delivery.feature');
    expect(result.code).toBe('');
    expect(result.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['FEATURE_STEP_UNSUPPORTED']),
    );
    expect(result).toMatchSnapshot();
  });

  it('rejects malformed Gherkin, invalid JSON, and unbound clients', () => {
    const malformed = compileFeature({ catalog, source: 'not a Gherkin document', clients });
    expect(malformed.code).toBe('');
    expect(malformed.diagnostics.map(({ code }) => code)).toContain('FEATURE_SYNTAX');

    const invalidJson = compileFeature({
      catalog,
      clients,
      source: `@subsystem:orders
Feature: Invalid JSON
  Scenario: broken body
    When client "api" sends POST "/items" with JSON:
      """json
      { not-json }
      """
    Then the response status is 200`,
    });
    expect(invalidJson.code).toBe('');
    expect(invalidJson.diagnostics.map(({ code }) => code)).toContain('FEATURE_JSON_INVALID');

    const unbound = compileFeature({
      catalog,
      clients: {},
      source: `@subsystem:orders
Feature: Unknown client
  Scenario: unknown binding
    When client "api" sends GET "/health"
    Then the response status is 200`,
    });
    expect(unbound.code).toBe('');
    expect(unbound.diagnostics.map(({ code }) => code)).toContain('CLIENT_UNKNOWN');
    expect({ malformed, invalidJson, unbound }).toMatchSnapshot();
  });
});

function compileExample(source: string, uri: string) {
  return compileFeature({ catalog, source, uri, clients });
}
