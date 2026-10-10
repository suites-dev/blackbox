import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { compileFromFiles } from '../src/cli/feature-commands.js';

it('binds executable clients without treating descriptions, comments, or JSON as references', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'feature-clients-'));
  try {
    const feature = path.join(directory, 'source.feature');
    const clients = path.join(directory, 'clients.ts');
    await writeFile(clients, 'export const api = {};\nexport const unused = {};\n');
    const source = `Feature: client "featureTitle"
  A description mentioning client "description".
  # client "comment"
  Background: client "backgroundTitle"
    Given client "api" sends GET "/health"
  Rule: client "ruleTitle"
    Background: rule setup
      Given client "api" sends GET "/ready"
    Scenario Outline: client "scenarioTitle"
      When client "api" sends POST "/echo" with JSON:
        """json
        {"note": "client \\"jsonText\\"", "value": "<value>"}
        """
      Then the response status is 200
      Examples:
        | value |
        | client "exampleText" |
`;
    await writeFile(feature, source);
    const result = await compileFromFiles(feature, clients, path.join(directory, 'suite.ts'));
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain('import { api as client_api } from ".\\u002Fclients.js";');
    expect(result.code).not.toContain('unused as client_unused');
    expect(result.code).not.toMatch(/import \{ (?:featureTitle|description|comment|jsonText|exampleText) /u);
    await writeFile(feature, source.replace('Given client "api"', 'Given client "missing"'));
    const missing = await compileFromFiles(feature, clients, undefined);
    expect(missing.code).toBe('');
    expect(missing.diagnostics).toEqual([expect.objectContaining({ code: 'CLIENT_EXPORT_MISSING', message: expect.stringContaining('"missing"') })]);
    await writeFile(feature, 'not a Gherkin document # client "missing"');
    const malformed = await compileFromFiles(feature, clients, undefined);
    expect(malformed.code).toBe('');
    expect(malformed.diagnostics.map(({ code }) => code)).toEqual(['FEATURE_SYNTAX']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
