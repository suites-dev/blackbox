import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { GherkinConfigError, parseGherkinProject } from './config.js';

// Requirements (task 2.4, report section 4): blackbox.gherkin.json is the one
// protected project file. It holds the feature globs, the output
// path, the change classes, and the Sandbox profiles with their named
// credentials, which name environment variables and never hold a value.
// Anything it does not document is refused.

const ROOT = '/project';
const FILE = join(ROOT, 'blackbox.gherkin.json');

const VALID = {
  schemaVersion: 1,
  blackboxConfigFile: 'blackbox.config.yaml',
  features: ['features/**/*.feature'],
  outputDir: '.features-gen',
  sandboxes: {
    default: {
      environment: { FIXTURE_CONTROL_TOKEN: { fromEnv: 'BLACKBOX_E2E_FIXTURE_TOKEN' } },
      credentials: { 'fixture-control': { scheme: 'bearer', fromEnv: 'BLACKBOX_E2E_FIXTURE_TOKEN' } },
    },
  },
  changes: { neutral: ['**/*.md'] },
};

function problems(document: unknown): readonly string[] {
  try {
    parseGherkinProject(document, FILE);
    return [];
  } catch (error) {
    if (error instanceof GherkinConfigError) {
      return error.problems;
    }
    throw error;
  }
}

describe('a valid project file', () => {
  it('resolves every path from its own directory and keeps globs relative', () => {
    expect(parseGherkinProject(VALID, FILE)).toEqual({
      root: ROOT,
      configFile: FILE,
      blackboxConfigFile: join(ROOT, 'blackbox.config.yaml'),
      features: ['features/**/*.feature'],
      outputDir: join(ROOT, '.features-gen'),
      sandboxProfiles: VALID.sandboxes,
      changes: { spec: [], neutral: ['**/*.md'] },
    });
  });

  it('defaults changes, environment and credentials to empty', () => {
    const { changes, ...required } = VALID;
    const project = parseGherkinProject({ ...required, sandboxes: { bare: {} } }, FILE);
    expect(project).toMatchObject({ changes: { spec: [], neutral: [] } });
    expect(project.sandboxProfiles).toEqual({ bare: { environment: {}, credentials: {} } });
    expect(changes).toBeDefined();
  });
});

describe('a refused project file', () => {
  it('names unknown settings, so a misspelled key is never silently dropped', () => {
    expect(problems({ ...VALID, retries: 2, sandboxs: {} })).toEqual([
      'retries: is not a known setting (known: schemaVersion, blackboxConfigFile, features, outputDir, sandboxes, changes)',
      'sandboxs: is not a known setting (known: schemaVersion, blackboxConfigFile, features, outputDir, sandboxes, changes)',
    ]);
  });

  it('refuses a credential value: credentials name environment variables only', () => {
    const sandboxes = { default: { credentials: { 'fixture-control': { scheme: 'bearer', token: 'secret' } } } };
    expect(problems({ ...VALID, sandboxes })).toEqual([
      'sandboxes.default.credentials.fixture-control.token: is not a known setting (known: scheme, fromEnv)',
      'sandboxes.default.credentials.fixture-control.fromEnv: must be a non-empty string',
    ]);
  });

  it('refuses other credential schemes, bad names and environment values', () => {
    const sandboxes = {
      'bad profile': {},
      default: {
        environment: { TOKEN: 'literal-value', 'NOT-A-NAME': { fromEnv: 'X' } },
        credentials: { Admin: { scheme: 'bearer', fromEnv: 'ADMIN' }, admin: { scheme: 'basic', fromEnv: 'not a variable' } },
      },
    };
    expect(problems({ ...VALID, sandboxes })).toEqual([
      expect.stringMatching(/^sandboxes\.bad profile: is not a valid name/u),
      expect.stringMatching(/^sandboxes\.default\.environment\.NOT-A-NAME: is not a valid name/u),
      'sandboxes.default.environment.TOKEN: must be an object',
      'sandboxes.default.environment.TOKEN.fromEnv: must be a non-empty string',
      expect.stringMatching(/^sandboxes\.default\.credentials\.Admin: is not a valid name/u),
      'sandboxes.default.credentials.admin.scheme: must be "bearer", the only credential scheme in v1',
      'sandboxes.default.credentials.admin.fromEnv: must name an environment variable',
    ]);
  });

  it('refuses missing settings, absolute paths, globs outside the project and output outside it', () => {
    expect(
      problems({
        ...VALID,
        schemaVersion: 2,
        blackboxConfigFile: '/etc/blackbox.config.yaml',
        features: ['../shared/**/*.feature'],
        outputDir: '..',
        sandboxes: {},
      }),
    ).toEqual([
      'schemaVersion: must be 1',
      'outputDir: must be a directory inside the project directory',
      'blackboxConfigFile: must be a relative path with "/" separators',
      'features[0]: must stay inside the project directory and be normalized',
      'sandboxes: must define at least one Sandbox profile',
    ]);
    expect(problems({ ...VALID, features: [] })).toEqual(['features: must be a non-empty array of globs']);
    expect(problems([])).toEqual(['must be an object']);
  });
});

describe('names that address the prototype chain', () => {
  // As read from a file: JSON.parse makes "__proto__" an own key, as an attacker-supplied file would.
  const document = JSON.parse(`{
    "schemaVersion": 1,
    "blackboxConfigFile": "blackbox.config.yaml",
    "features": ["features/**/*.feature"],
    "outputDir": ".features-gen",
    "sandboxes": {
      "__proto__": { "environment": { "polluted": { "fromEnv": "X" } } },
      "constructor": {},
      "default": {
        "environment": { "__proto__": { "fromEnv": "POLLUTED" }, "prototype": { "fromEnv": "X" } },
        "credentials": { "constructor": { "scheme": "bearer", "fromEnv": "X" } }
      }
    }
  }`) as unknown;

  it('are refused with a clear error and never reach Object.prototype', () => {
    const before = Object.getOwnPropertyNames(Object.prototype).sort();
    expect(problems(document)).toEqual([
      'sandboxes.__proto__: is a reserved name; choose another name',
      'sandboxes.constructor: is a reserved name; choose another name',
      'sandboxes.default.environment.__proto__: is a reserved name; choose another name',
      'sandboxes.default.environment.prototype: is a reserved name; choose another name',
      'sandboxes.default.credentials.constructor: is a reserved name; choose another name',
    ]);
    expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before);
    const probe: Record<string, unknown> = {};
    expect([probe.fromEnv, probe.environment, probe.polluted, probe.scheme]).toEqual([undefined, undefined, undefined, undefined]);
  });
});
