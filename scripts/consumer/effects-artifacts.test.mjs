import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { isolatedEnvironment } from './effects-artifacts.mjs';

test('isolates npm configuration and Node loading without mutating the inherited environment', () => {
  const inherited = {
    PATH: '/parent/tools',
    CUSTOM_SETTING: 'preserved',
    TMPDIR: '/parent/tmp',
    NPM_CONFIG_REGISTRY: 'https://registry.example.invalid/',
    nPm_CoNfIg_CaChE: '/parent/cache',
    npm_config_userconfig: '/parent/npmrc',
    npm_config_offline: 'false',
    npm_config_ignore_scripts: 'false',
    NODE_OPTIONS: '--require=/parent/hook.cjs',
    NODE_PATH: '/parent/modules',
  };
  const original = { ...inherited };
  const directory = '/owned/consumer temporary';
  assert.deepEqual(isolatedEnvironment(directory, inherited), {
    PATH: '/parent/tools',
    CUSTOM_SETTING: 'preserved',
    TMPDIR: directory,
    npm_config_cache: join(directory, 'npm-cache'),
    npm_config_userconfig: join(directory, 'empty.npmrc'),
    npm_config_offline: 'true',
    npm_config_ignore_scripts: 'true',
  });
  assert.deepEqual(inherited, original);
});

test('preserves prototype-looking environment names as own data properties', () => {
  const inherited = JSON.parse(
    '{"__proto__":"literal prototype value","constructor":"literal constructor value"}',
  );
  const environment = isolatedEnvironment('/owned/consumer', inherited);
  assert.equal(Object.getPrototypeOf(environment), Object.prototype);
  assert.equal(Object.hasOwn(environment, '__proto__'), true);
  assert.equal(Object.hasOwn(environment, 'constructor'), true);
  assert.equal(environment.__proto__, 'literal prototype value');
  assert.equal(environment.constructor, 'literal constructor value');
});
