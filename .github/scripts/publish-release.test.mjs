import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflow = readFileSync(path.join(root, '.github/workflows/publish-release.yml'), 'utf8');
const version = JSON.parse(readFileSync(path.join(root, 'lerna.json'), 'utf8')).version;

function runStep(name, workflowSource = workflow) {
  const lines = workflowSource.split('\n');
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

const packageStep = runStep('Verify the fixed Lerna package set');
const packageFilter = packageStep.match(
  /jq -e --arg version "\$VERSION" '([\s\S]*?)'\s+<<<"\$packages"/u,
)?.[1];
assert.ok(packageFilter, 'release package gate must evaluate the Lerna package set');

function distributionFor(releaseVersion) {
  const result = spawnSync(
    'bash',
    [path.join(root, '.github/scripts/release-channel.sh'), releaseVersion],
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

test('the workflow uses the tested channel selector', () => {
  assert.ok(sourceStep.includes('channel="$(bash .github/scripts/release-channel.sh "$version")"'));
  assert.ok(sourceStep.includes('read -r distribution_tag prerelease <<<"$channel"'));
});

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

test('release preview writes the source and proposed release as literal Markdown', (t) => {
  const preview = readFileSync(path.join(root, '.github/workflows/release-preview.yml'), 'utf8');
  const receiptDir = mkdtempSync(path.join(tmpdir(), 'blackbox-release-preview-'));
  t.after(() => rmSync(receiptDir, { recursive: true, force: true }));

  const summary = path.join(receiptDir, 'step-summary.md');
  const sourceRef = 'release/v0.0.1-alpha';
  const releaseType = 'prerelease';
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  assert.equal(commit.status, 0, commit.stderr);

  const result = spawnSync('bash', ['-e', '-c', runStep('Summarize proposed release', preview)], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH,
      GITHUB_STEP_SUMMARY: summary,
      SOURCE_REF: sourceRef,
      RELEASE_TYPE: releaseType,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const lines = readFileSync(summary, 'utf8').split('\n');
  assert.ok(lines.includes(`- Source ref: \`${sourceRef}\``));
  assert.ok(lines.includes(`- Source commit: \`${commit.stdout.trim()}\``));
  assert.ok(lines.includes(`- Transition: \`${releaseType}\``));
  assert.ok(lines.includes(`- Proposed fixed version: \`${version}\``));
  assert.equal(result.stderr, '');
});
