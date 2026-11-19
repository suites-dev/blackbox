// Run in the isolated consumer built from the standalone CLI's onboarding receipt.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cli = resolve('node_modules/.bin/blackbox');
const run = (...args) => execFileSync(cli, args, { encoding: 'utf8', timeout: 15_000 });
const receipt = () => JSON.parse(run('onboarding', 'start', '--json'));
const before = readdirSync('.');
const manifest = readFileSync('package.json', 'utf8');
const lock = readFileSync('pnpm-lock.yaml', 'utf8');

const full = receipt();
const prompt = run('onboarding', 'start');
const expectedPackages = [
  '@suites/blackbox',
  '@suites/blackbox-cli',
  '@suites/blackbox-capsule',
  '@suites/blackbox-driver',
  '@suites/blackbox-inst-runtime-node',
];
assert.deepEqual([...full.livePackages].sort(), expectedPackages.sort());
assert.deepEqual(
  full.packages.map(({ name }) => name).sort(),
  [
    ...expectedPackages,
    '@suites/blackbox-skills',
    '@suites/blackbox-catalog',
    '@suites/blackbox-discovery',
  ].sort(),
);
const cliManifest = JSON.parse(
  readFileSync('node_modules/@suites/blackbox-cli/package.json', 'utf8'),
);
for (const { name, version } of full.packages) {
  assert.equal(version, cliManifest.version);
  assert.ok(prompt.includes(`${name} ${version}`));
}
for (const step of full.instructions) assert.ok(prompt.includes(step));
for (const name of expectedPackages) assert.ok(full.instructions[0].includes(name));
const playwright = JSON.parse(
  readFileSync(new URL('../../playwright/package.json', import.meta.url), 'utf8'),
);
for (const prerequisite of [
  'configured registry',
  'lockfile',
  `Node.js ${cliManifest.engines.node}`,
  '@suites/blackbox-playwright',
  `@playwright/test peer (${playwright.peerDependencies['@playwright/test']})`,
  'references/onboarding.md',
  'system boundary',
  'blackbox.config.yaml',
  'native Playwright acceptance spec',
])
  assert.ok(
    full.instructions.some((step) => step.includes(prerequisite)),
    prerequisite,
  );
const expectedCommands = [
  'skills list',
  'skills install',
  'catalog validate',
  'systems',
  'driver install',
  'inst install',
  'capsule up',
  'capsule run',
  'capsule show',
  'capsule down',
  'capsule ls',
  'capsule report',
];
assert.deepEqual(
  full.commands
    .filter(({ available }) => available)
    .map(({ name }) => name)
    .sort(),
  expectedCommands.sort(),
);
for (const command of expectedCommands) {
  assert.ok(prompt.includes(`available  blackbox ${command}`));
  assert.match(run(...command.split(' '), '--help'), /USAGE/u);
}
for (const extra of ['--unsupported', 'unexpected']) {
  const invalid = spawnSync(cli, ['onboarding', 'start', extra], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.equal(invalid.error, undefined);
  assert.ok(Number.isInteger(invalid.status) && invalid.status !== 0);
}
assert.deepEqual(readdirSync('.'), before);
assert.equal(readFileSync('package.json', 'utf8'), manifest);
assert.equal(readFileSync('pnpm-lock.yaml', 'utf8'), lock);
console.log(
  'packed onboarding: complete prompt, versioned inventory, 12 live route commands, project unchanged',
);

// Exercise the host installation commands exactly as emitted in the human prompt.
const installCommands = [...prompt.matchAll(/^\s*(blackbox skills install (\w+) --codex)$/gmu)];
assert.deepEqual(installCommands.map(([, , skill]) => skill).sort(), [
  'blackbox',
  'capsule',
  'catalog',
  'discovery',
]);
for (const [, command, skill] of installCommands) {
  run(...command.split(' ').slice(1));
  assert.match(
    readFileSync(`.agents/skills/${skill}/SKILL.md`, 'utf8'),
    new RegExp(`^name: ${skill}$`, 'mu'),
  );
}

// Keep the package on disk and remove only the consumer's explicit selection.
const withoutNode = JSON.parse(manifest);
const plugin = '@suites/blackbox-inst-runtime-node';
delete withoutNode.dependencies[plugin];
writeFileSync('package.json', JSON.stringify(withoutNode));
assert.equal(JSON.parse(readFileSync(`node_modules/${plugin}/package.json`, 'utf8')).name, plugin);
const missing = receipt();
assert.deepEqual(
  missing.packages,
  full.packages.filter(({ name }) => name !== plugin),
);
assert.deepEqual(
  missing.commands,
  full.commands.map((command) =>
    command.name === 'inst install' ? { ...command, available: false } : command,
  ),
);
assert.ok(run('onboarding', 'start').includes('missing  blackbox inst install'));
console.log(
  'packed onboarding: four project skills installed, unselected Node plugin reported missing',
);
