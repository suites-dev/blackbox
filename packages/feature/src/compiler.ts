/* eslint-disable complexity -- Keep the closed compiler dispatch easy to review in source order. */
/* eslint-disable no-restricted-syntax -- Cucumber's public AST and the inline-source API have optional fields. */
/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Preserve runtime guards at this untrusted input boundary. */
/* eslint-disable max-lines -- Keep one compiler pass together while its public output contract is new. */
import type {
  Background,
  GherkinDocument,
  Rule,
  Scenario,
  Step,
} from '@cucumber/messages';

import { parseGherkin } from './syntax/parse.js';

export interface FeatureClientBinding {
  readonly from: string;
  readonly export: string;
}

export interface FeatureDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly line: number;
  readonly column: number;
}

export interface CompileFeatureOptions {
  readonly source: string;
  readonly uri?: string;
  readonly clients: Readonly<Record<string, FeatureClientBinding>>;
}

export interface CompileFeatureResult {
  readonly code: string;
  readonly diagnostics: readonly FeatureDiagnostic[];
}

/** Compile the explicitly supported HTTP vocabulary into native Playwright declarations. */
export function compileFeature(options: CompileFeatureOptions): CompileFeatureResult {
  const uri = options.uri ?? 'inline.feature';
  let document: GherkinDocument;
  try {
    document = parseGherkin(options.source, uri).document;
  } catch (error) {
    const position = parsePosition(error);
    return {
      code: '',
      diagnostics: [{
        code: 'FEATURE_SYNTAX',
        message: error instanceof Error ? error.message : 'Invalid Gherkin syntax.',
        ...position,
      }],
    };
  }

  const feature = document.feature;
  if (!feature) {return { code: '', diagnostics: [diagnostic('FEATURE_EMPTY', 'No Feature was found.', 1, 1)] };}

  const context: CompilerContext = { options, diagnostics: [], counter: 0, lastResponse: null };
  validateClientBindings(options.clients, context);
  if (!feature.children.some((child) => Boolean(child.scenario ?? child.rule?.children.some((nested) => nested.scenario)))) {
    context.diagnostics.push(diagnostic('FEATURE_SCENARIO_MISSING', 'Feature must contain at least one Scenario.', 1, 1));
  }
  const declarations: string[] = [];
  const featureBackground = feature.children.flatMap((child) => child.background ? [child.background] : []);
  if (featureBackground.length > 1) {
    context.diagnostics.push(diagnostic('FEATURE_BACKGROUND_DUPLICATE', 'A Feature may have only one Background.', featureBackground[1].location?.line ?? 1, 1));
  }

  const featureSteps = featureBackground[0]?.steps ?? [];
  if (featureSteps.length > 0) {declarations.push(emitBackground(featureBackground[0], context));}

  for (const child of feature.children) {
    if (child.rule) {declarations.push(emitRule(child.rule, context));}
    else if (child.scenario) {declarations.push(...emitScenario(child.scenario, context));}
  }

  if (context.diagnostics.length > 0) {return { code: '', diagnostics: context.diagnostics };}
  const tags = feature.tags.map((tag) => tag.name).filter((tag) => !tag.startsWith('@subsystem:') && !tag.startsWith('@system:') && !tag.startsWith('@sandbox:'));
  const systemTag = feature.tags.find((tag) => tag.name.startsWith('@system:'));
  const subsystemTag = feature.tags.find((tag) => tag.name.startsWith('@subsystem:'));
  const systemKind = systemTag ? 'system' : 'subsystem';
  const systemId = systemTag ? systemTag.name.slice(8) : subsystemTag ? subsystemTag.name.slice(11) : feature.name;
  const sandbox = feature.tags.find((tag) => tag.name.startsWith('@sandbox:'))?.name.slice(9) ?? 'default';
  const systemSelector = `{ kind: '${systemKind}', id: ${quote(systemId)} }`;
  const clientNames = Object.keys(options.clients).sort();
  const clientProperties = clientNames.map((name) => `${quote(name)}: ${localName(name)}`).join(', ');
  const imports = clientNames.map((name) => {
    const binding = options.clients[name];
    return `import { ${binding.export} as ${localName(name)} } from ${quote(binding.from)};`;
  });
  const featureDetails = tags.length ? `, { tag: ${JSON.stringify(tags)} }` : '';
  const suiteBody = declarations.map((declaration) => indent(declaration, 6)).join('\n');
  const code = [
    `import { expect, test } from '@suites/blackbox-playwright';`,
    ...imports,
    '',
    `test.system(${systemSelector}, (system) => {`,
    `  system.sandbox(${quote(sandbox)}, { clients: { ${clientProperties} } }, (suite) => {`,
    `    suite.describe(${quote(`Feature: ${feature.name}`)}${featureDetails}, () => {`,
    suiteBody,
    `    });`,
    `  });`,
    `});`,
    '',
  ].join('\n');
  return { code, diagnostics: [] };
}

interface CompilerContext {
  readonly options: CompileFeatureOptions;
  readonly diagnostics: FeatureDiagnostic[];
  counter: number;
  lastResponse: string | null;
}

function validateClientBindings(clients: CompileFeatureOptions['clients'], context: CompilerContext): void {
  for (const [name, binding] of Object.entries(clients)) {
    if (!/^[A-Za-z_$][\w$]*$/u.test(name)) {context.diagnostics.push(diagnostic('CLIENT_NAME_INVALID', `Client name ${quote(name)} is not a valid identifier.`, 1, 1));}
    if (!binding.from || !binding.export) {context.diagnostics.push(diagnostic('CLIENT_BINDING_INVALID', `Client ${quote(name)} needs an explicit module and export binding.`, 1, 1));}
  }
}

function emitRule(rule: Rule, context: CompilerContext): string {
  const children: string[] = [];
  const background = rule.children.find((child) => child.background)?.background;
  if (background?.steps.length) {children.push(emitBackground(background, context));}
  for (const child of rule.children) {
    if (child.scenario) {children.push(...emitScenario(child.scenario, context));}
  }
  const tags = rule.tags.map((tag) => tag.name);
  const details = tags.length ? `, { tag: ${JSON.stringify(tags)} }` : '';
  return `suite.describe(${quote(`Rule: ${rule.name}`)}${details}, () => {\n${indent(children.join('\n\n'), 2)}\n});`;
}

function emitBackground(background: Background, context: CompilerContext): string {
  const steps = background.steps.map((step) => emitStep(step, context));
  return `suite.beforeEach(${quote(`Background: ${background.name || 'setup'}`)}, async ({ clients, step }) => {\n${indent(steps.join('\n'), 2)}\n});`;
}

function emitScenario(scenario: Scenario, context: CompilerContext): string[] {
  if (scenario.steps.length === 0) {
    context.diagnostics.push(diagnostic('FEATURE_SCENARIO_EMPTY', 'Scenario must contain at least one supported step.', scenario.location?.line ?? 1, 1));
    return [];
  }
  const examples = scenario.examples;
  if (!examples.length) {return [emitTest(scenario, context)];}
  const output: string[] = [];
  for (const [exampleIndex, example] of examples.entries()) {
    context.lastResponse = null;
    const rows = example.tableBody;
    const headers = example.tableHeader?.cells.map((cell) => cell.value) ?? [];
    const rowValues = rows.map((row) => Object.fromEntries(row.cells.map((cell, index) => [headers[index], parseExampleValue(cell.value)])));
    const rowsName = `outlineRows${context.counter++}`;
    const scenarioTags = scenario.tags.map((tag) => tag.name);
    const scenarioDetails = scenarioTags.length ? `, { tag: ${JSON.stringify(scenarioTags)} }` : '';
    const exampleTags = example.tags.map((tag) => tag.name);
    const exampleDetails = exampleTags.length ? `, { tag: ${JSON.stringify(exampleTags)} }` : '';
    const rowTitle = stringExpression(`Scenario: ${scenario.name} [Examples ${exampleIndex + 1}: ${example.name || 'Examples'}, row __BLACKBOX_ROW_INDEX__]`, true)
      .replace('__BLACKBOX_ROW_INDEX__', '${rowIndex + 1}');
    output.push(`suite.describe(${quote(`Scenario Outline: ${scenario.name}`)}, () => {\n  suite.describe(${quote(`Examples: ${example.name || `Examples ${exampleIndex + 1}`}`)}${exampleDetails}, () => {\n    const ${rowsName} = ${JSON.stringify(rowValues)};\n    ${rowsName}.forEach((row, rowIndex) => {\n      suite.test(${rowTitle}${scenarioDetails}, async ({ clients, step }) => {\n${indent(emitStepList(scenario.steps, context, true, headers), 8)}\n      });\n    });\n  });\n});`);
  }
  return output;
}

function emitTest(scenario: Scenario, context: CompilerContext): string {
  context.lastResponse = null;
  const tags = scenario.tags.map((tag) => tag.name);
  const details = tags.length ? `, { tag: ${JSON.stringify(tags)} }` : '';
  return `suite.test(${quote(`Scenario: ${scenario.name}`)}${details}, async ({ clients, step }) => {\n${indent(emitStepList(scenario.steps, context), 2)}\n});`;
}

function emitStepList(steps: readonly Step[], context: CompilerContext, dynamicRow = false, dynamicHeaders: readonly string[] = []): string {
  return steps.map((step) => emitStep(step, context, dynamicRow, dynamicHeaders)).join('\n');
}

function emitStep(step: Step, context: CompilerContext, dynamicRow = false, dynamicHeaders: readonly string[] = []): string {
  const text = step.text;
  const title = `${step.keyword}${text}`.trim();
  const doc = step.docString?.content;
  const exactJson = /^client "([\w$-]+)" GET "([^"\n]+)" returns (\d{3}) with JSON exactly:?$/u.exec(text);
  if (exactJson) {
    const [, client, path, expectedStatus] = exactJson;
    assertClient(client, step, context);
    if (!doc) {return unsupported(step, context, 'Exact JSON assertion needs a JSON Doc String.');}
    const expected = dynamicRow ? rowJsonExpression(doc, step, context, dynamicHeaders) : jsonExpression(doc, step, context);
    return `await step(${stringExpression(title, dynamicRow)}, async () => {\n  const response = await clients.${client}.get(${stringExpression(path, dynamicRow)});\n  expect(response.status()).toBe(${expectedStatus});\n  expect(await response.json()).toEqual(${expected});\n});`;
  }
  const request = /^client "([\w$-]+)" (?:has sent|sends) (GET|POST|PUT|PATCH|DELETE) "([^"\n]+)"(?: with JSON)?(?: and received (\d{3}))?:?$/u.exec(text);
  if (request) {
    const [, client, method, path, expectedStatus] = request;
    assertClient(client, step, context);
    const body = doc ? `, { data: ${dynamicRow ? rowJsonExpression(doc, step, context, dynamicHeaders) : jsonExpression(doc, step, context)} }` : '';
    const response = `clients.${client}.${method.toLowerCase()}(${stringExpression(path, dynamicRow)}${body})`;
    const variable = `response${context.counter++}`;
    context.lastResponse = variable;
    if (expectedStatus) {return `const ${variable} = await step(${stringExpression(title, dynamicRow)}, async () => {\n  const response = await ${response};\n  expect(response.status()).toBe(${expectedStatus});\n  return response;\n});`;}
    return `const ${variable} = await step(${stringExpression(title, dynamicRow)}, () => ${response});`;
  }
  const status = /^the response status is (\d{3}|<[^>]+>)$/u.exec(text);
  if (status) {
    const response = context.lastResponse;
    if (!response) {return unsupported(step, context, 'Response status assertion has no preceding HTTP request in this scenario.');}
    const expected = status[1].startsWith('<') ? `Number(row[${quote(status[1].slice(1, -1))}])` : status[1];
    return `await step(${stringExpression(title, dynamicRow)}, async () => {\n  expect(${response}.status()).toBe(${expected});\n});`;
  }
  if (/^the response JSON contains:?$/u.test(text) && doc) {
    const response = context.lastResponse;
    if (!response) {return unsupported(step, context, 'Response JSON assertion has no preceding HTTP request in this scenario.');}
    return `await step(${stringExpression(title, dynamicRow)}, async () => {\n  expect(await ${response}.json()).toMatchObject(${dynamicRow ? rowJsonExpression(doc, step, context, dynamicHeaders) : jsonExpression(doc, step, context)});\n});`;
  }
  if (/^the response JSON contains these fields:?$/u.test(text) && step.dataTable) {
    const rows = step.dataTable.rows.map((row) => row.cells.map((cell) => cell.value));
    if (rows.length < 2 || rows[0][0] !== 'field' || rows[0][1] !== 'json') {return unsupported(step, context, 'Expected a Data Table with `field` and `json` columns.');}
    const values: string[] = [];
    for (const [field, raw] of rows.slice(1)) {
      if (values.some((value) => value.startsWith(`${quote(field)}:`))) {return unsupported(step, context, `Duplicate expected field ${quote(field)}.`);}
      try { values.push(`${quote(field)}: ${JSON.stringify(JSON.parse(raw))}`); }
      catch { return unsupported(step, context, `Invalid JSON value for field ${quote(field)}.`); }
    }
    const response = context.lastResponse;
    if (!response) {return unsupported(step, context, 'Response JSON assertion has no preceding HTTP request in this scenario.');}
    const expected = dynamicRow ? rowJsonExpression(`{ ${values.join(', ')} }`, step, context, dynamicHeaders) : `{ ${values.join(', ')} }`;
    return `await step(${stringExpression(title, dynamicRow)}, async () => {\n  expect(await ${response}.json()).toMatchObject(${expected});\n});`;
  }
  return unsupported(step, context, `Unsupported Feature step: ${quote(text)}.`);
}

function assertClient(name: string, step: Step, context: CompilerContext): void {
  if (!context.options.clients[name]) {context.diagnostics.push(diagnostic('CLIENT_UNKNOWN', `Step refers to unbound client ${quote(name)}.`, step.location?.line ?? 1, step.location?.column ?? 1));}
}

function jsonExpression(value: string, step: Step, context: CompilerContext): string {
  try { return escapeUnsafeJsChars(JSON.stringify(JSON.parse(value))); }
  catch {
    context.diagnostics.push(diagnostic('FEATURE_JSON_INVALID', 'Doc String must contain valid JSON.', step.location?.line ?? 1, step.location?.column ?? 1));
    return 'null';
  }
}

function unsupported(step: Step, context: CompilerContext, message: string): string {
  context.diagnostics.push(diagnostic('FEATURE_STEP_UNSUPPORTED', message, step.location?.line ?? 1, step.location?.column ?? 1));
  return '';
}

function rowJsonExpression(
  value: string,
  step: Step,
  context: CompilerContext,
  dynamicHeaders: readonly string[],
): string {
  const markers = new Map<string, { readonly name: string; readonly insideString: boolean }>();
  let normalized = '';
  let insideString = false;
  let escaped = false;
  let markerIndex = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    if (character === '<') {
      const placeholder = /^<([^<>]+)>/u.exec(value.slice(index));
      if (placeholder) {
        const name = placeholder[1] ?? '';
        const marker = `__BLACKBOX_ROW_${markerIndex++}__`;
        markers.set(marker, { name, insideString });
        normalized += insideString ? marker : JSON.stringify(marker);
        index += placeholder[0].length - 1;
        continue;
      }
    }

    normalized += character;
    if (insideString) {
      if (escaped) {escaped = false;}
      else if (character === '\\') {escaped = true;}
      else if (character === '"') {insideString = false;}
    } else if (character === '"') {insideString = true;}
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(JSON.parse(normalized));
  } catch {
    context.diagnostics.push(diagnostic('FEATURE_JSON_INVALID', 'Outline JSON must remain valid after Examples substitution.', step.location?.line ?? 1, step.location?.column ?? 1));
    return 'null';
  }

  const templateMarkers: { readonly marker: string; readonly replacement: string }[] = [];
  for (const [index, [marker, placeholder]] of [...markers.entries()].entries()) {
    const generatedMarker = placeholder.insideString
      ? `__BLACKBOX_STRING_ROW_${index}__`
      : `__BLACKBOX_VALUE_ROW_${index}__`;
    const markerToReplace = placeholder.insideString ? marker : JSON.stringify(marker);
    serialized = serialized.replace(markerToReplace, generatedMarker);
    if (!dynamicHeaders.includes(placeholder.name)) {
      context.diagnostics.push(diagnostic('FEATURE_OUTLINE_HEADER_UNKNOWN', `Outline placeholder <${placeholder.name}> has no matching Examples column.`, step.location?.line ?? 1, step.location?.column ?? 1));
    }
    const rowValue = `row[${quote(placeholder.name)}]`;
    const replacement = placeholder.insideString
      ? `\${JSON.stringify(String(${rowValue})).slice(1, -1)}`
      : `\${JSON.stringify(${rowValue})}`;
    templateMarkers.push({ marker: generatedMarker, replacement });
  }

  let template = templateString(serialized);
  for (const { marker, replacement } of templateMarkers) {
    template = template.replace(marker, replacement);
  }
  return `JSON.parse(${template})`;
}

function parseExampleValue(value: string): string | number | boolean | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === 'string' || typeof parsed === 'number' || typeof parsed === 'boolean' || parsed === null) {
      return parsed;
    }
  } catch {
    // Most Examples values are plain strings rather than JSON literals.
  }
  return value;
}

function stringExpression(value: string, dynamicRow: boolean): string {
  if (!dynamicRow) {return quote(value);}
  const placeholders: { readonly marker: string; readonly name: string }[] = [];
  const marked = value.replace(/<([^>]+)>/gu, (_match, name: string) => {
    const marker = `__BLACKBOX_DYNAMIC_VALUE-${placeholders.length}__`;
    placeholders.push({ marker, name });
    return marker;
  });
  let template = templateString(marked);
  for (const { marker, name } of placeholders) {template = template.replace(marker, () => `\${row[${quote(name)}]}`);}
  return template;
}

function templateString(value: string): string {
  const escaped = value.replace(/\\/gu, '\\\\').replace(/`/gu, '\\`').replace(/\$\{/gu, '\\${');
  const dynamic = escaped
    .replace(/__BLACKBOX_JSON_DYNAMIC_([A-Za-z_$][\w$]*)__/gu, '${JSON.stringify(row["$1"])}')
    .replace(/__BLACKBOX_DYNAMIC_([A-Za-z_$][\w$]*)__/gu, '${row["$1"]}');
  return `\`${dynamic}\``;
}

function parsePosition(error: unknown): Pick<FeatureDiagnostic, 'line' | 'column'> {
  const message = error instanceof Error ? error.message : '';
  const match = /\((\d+):(\d+)\)/u.exec(message);
  return match ? { line: Number(match[1]), column: Number(match[2]) } : { line: 1, column: 1 };
}

function diagnostic(code: string, message: string, line: number, column: number): FeatureDiagnostic {
  return { code, message, line, column };
}

const charMap: Record<string, string> = {
  '<': '\\u003C',
  '>': '\\u003E',
  '/': '\\u002F',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

function escapeUnsafeJsChars(value: string): string {
  return value.replace(/[<>/\u2028\u2029]/gu, (char) => charMap[char] ?? char);
}

function quote(value: string): string {
  return escapeUnsafeJsChars(JSON.stringify(value));
}

function localName(value: string): string {
  return `client_${value.replace(/[^A-Za-z0-9_$]/gu, '_')}`;
}

function indent(value: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return value.split('\n').map((line) => line ? `${prefix}${line}` : line).join('\n');
}
