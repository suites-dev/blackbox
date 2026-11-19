import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflow = readFileSync(path.join(root, '.github/workflows/publish-release.yml'), 'utf8');
const version = JSON.parse(readFileSync(path.join(root, 'lerna.json'), 'utf8')).version;

function runStep(name) {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === `      - name: ${name}`);
  assert.notEqual(start, -1, `missing workflow step: ${name}`);
  const run = lines.findIndex((line, index) => index > start && line === '        run: |');
  assert.notEqual(run, -1, `missing run script: ${name}`);
  const end = lines.findIndex((line, index) => index > run && line.startsWith('      - name: '));
  return lines
    .slice(run + 1, end === -1 ? undefined : end)
    .map((line) => line.replace(/^          /u, ''))
    .join('\n');
}

const sourceStep = runStep('Verify the immutable release source');
const distributionSelection = sourceStep.match(/^if \[\[ "\$version"[\s\S]*?^fi$/mu)?.[0];
assert.ok(distributionSelection, 'release source must select a distribution tag');

const packageStep = runStep('Verify the fixed Lerna package set');
const packageFilter = packageStep.match(
  /jq -e --arg version "\$VERSION" '([\s\S]*?)'\s+<<<"\$packages"/u,
)?.[1];
assert.ok(packageFilter, 'release package gate must evaluate the Lerna package set');

function distributionFor(releaseVersion) {
  const result = spawnSync(
    'bash',
    [
      '-eu',
      '-c',
      `version="$1"\n${distributionSelection}\nprintf '%s %s\\n' "$distribution_tag" "$prerelease"`,
      '--',
      releaseVersion,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

const workspacePackages = [
  path.join(root, 'e2e/package.json'),
  ...readdirSync(path.join(root, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, 'packages', entry.name, 'package.json'))
    .filter(existsSync),
].map((manifestPath) => {
  const {
    name,
    version: packageVersion,
    private: isPrivate,
  } = JSON.parse(readFileSync(manifestPath, 'utf8'));
  return { name, version: packageVersion, private: isPrivate === true };
});

function packageGate(packages) {
  return spawnSync('jq', ['-e', '--arg', 'version', version, packageFilter], {
    input: JSON.stringify(packages),
    encoding: 'utf8',
  });
}

test('alpha versions publish under alpha; other prereleases and stable versions keep their channels', () => {
  assert.equal(distributionFor('0.0.1-alpha.0'), 'alpha true');
  assert.equal(distributionFor('0.0.1-alpha'), 'alpha true');
  assert.equal(distributionFor('0.0.1-beta.1'), 'next true');
  assert.equal(distributionFor('0.0.1'), 'latest false');
});

test('the actual public package set and private E2E harness pass the release gate', () => {
  assert.ok(workspacePackages.some((entry) => entry.name === '@suites/blackbox' && !entry.private));
  assert.ok(
    workspacePackages.some(
      (entry) => entry.name === '@suites/blackbox-e2e-harness' && entry.private,
    ),
  );
  const result = packageGate(workspacePackages);
  assert.equal(result.status, 0, result.stderr);
});

for (const [name, mutate] of [
  [
    'public E2E harness',
    (packages) => {
      packages.find((entry) => entry.name === '@suites/blackbox-e2e-harness').private = false;
    },
  ],
  [
    'private public package',
    (packages) => {
      packages.find((entry) => entry.name === '@suites/blackbox').private = true;
    },
  ],
  [
    'wrong public version',
    (packages) => {
      packages.find((entry) => entry.name === '@suites/blackbox').version = '0.0.0';
    },
  ],
  [
    'foreign public name',
    (packages) => {
      packages.find((entry) => entry.name === '@suites/blackbox').name = '@foreign/blackbox';
    },
  ],
  [
    'unapproved private package',
    (packages) => {
      packages.push({ name: '@suites/blackbox-hidden', version, private: true });
    },
  ],
  [
    'internal public package',
    (packages) => {
      packages.push({ name: '@suites/blackbox-secret-internal', version, private: false });
    },
  ],
  [
    'missing core package',
    (packages) => {
      packages.splice(
        packages.findIndex((entry) => entry.name === '@suites/blackbox'),
        1,
      );
    },
  ],
]) {
  test(`the release gate rejects ${name}`, () => {
    const packages = structuredClone(workspacePackages);
    mutate(packages);
    const result = packageGate(packages);
    assert.notEqual(result.status, 0, `unexpectedly accepted ${name}`);
  });
}
