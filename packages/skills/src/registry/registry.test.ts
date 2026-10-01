import { describe, expect, it } from 'vitest';
import { bindCliSkillModules, readCliSkillModules } from '@suites/blackbox-cli-contract';
import { discoverySkill } from '../discovery.js';
import { skillModule } from '../skills.js';
import { createSkillRegistry } from './registry.js';
import type { SkillDefinition } from './contracts.js';

const feature = (name: string, dependencies: readonly string[] = []): SkillDefinition => ({
  name,
  source: new URL('file:///fixture/'),
  dependencies,
  integrations: [],
});
const moduleFor = (skills: readonly SkillDefinition[]) => ({
  apiVersion: 1,
  packageName: 'fixture',
  packageRoot: new URL('file:///fixture-package/'),
  skills,
});

describe('skill composition', () => {
  it('keeps optional integrations absent and never follows them as dependencies', () => {
    const registry = createSkillRegistry([skillModule]);
    expect(registry.get('capsule')).toBeNull();
    expect(registry.resolve(['discovery']).map(({ name }) => name)).toEqual(['discovery']);
    expect(() => registry.resolve(['capsule'])).toThrow('unavailable');
    const withCapsule = createSkillRegistry([skillModule, moduleFor([feature('capsule')])]);
    expect(withCapsule.get('capsule')).toMatchObject({ name: 'capsule' });
    expect(withCapsule.resolve(['discovery']).map(({ name }) => name)).toEqual(['discovery']);
  });

  it('resolves required dependencies once in dependency order and rejects missing or cyclic edges', () => {
    const registry = createSkillRegistry([
      moduleFor([feature('root', ['shared']), feature('other', ['shared']), feature('shared')]),
    ]);
    expect(registry.resolve(['root', 'other']).map(({ name }) => name)).toEqual([
      'shared',
      'root',
      'other',
    ]);
    expect(() =>
      createSkillRegistry([moduleFor([feature('root', ['missing'])])]).resolve(['root']),
    ).toThrow('missing');
    expect(() =>
      createSkillRegistry([moduleFor([feature('a', ['b']), feature('b', ['a'])])]).resolve(['a']),
    ).toThrow('cycle');
  });

  it('rejects duplicate ownership, unsafe names and invalid module/source contracts', () => {
    expect(() => createSkillRegistry([skillModule, skillModule])).toThrow('Duplicate');
    for (const name of ['../capsule', '/capsule', 'capsule/sub', '']) {
      expect(() => createSkillRegistry([moduleFor([feature(name)])])).toThrow('Invalid');
    }
    expect(() => createSkillRegistry([{ ...skillModule, apiVersion: 2 }])).toThrow('Invalid');
    expect(() =>
      createSkillRegistry([{ ...skillModule, packageRoot: new URL('https://example.com') }]),
    ).toThrow('Invalid');
    expect(() =>
      createSkillRegistry([
        moduleFor([{ ...discoverySkill, source: new URL('https://example.com') }]),
      ]),
    ).toThrow('Invalid');
  });

  it('snapshots contribution arrays and URL values independently of caller mutation', () => {
    const source = new URL('file:///safe/');
    const packageRoot = new URL('file:///package/');
    const dependencies: string[] = [];
    const registry = createSkillRegistry([
      { ...moduleFor([{ ...feature('fixture'), source, dependencies }]), packageRoot },
    ]);
    source.pathname = '/unsafe/';
    packageRoot.pathname = '/unsafe-package/';
    dependencies.push('missing');
    const resolved = registry.resolve(['fixture'])[0];
    resolved.source.pathname = '/mutated/';
    expect(resolved.source.href).toBe('file:///safe/');
    expect(resolved.packageRoot.href).toBe('file:///package/');
    expect(resolved.dependencies).toEqual([]);
  });

  it('isolates invocations and refuses rebinding one config', () => {
    const first = {};
    const second = {};
    bindCliSkillModules(first, [skillModule]);
    expect(readCliSkillModules(first)).toEqual([skillModule]);
    expect(readCliSkillModules(second)).toEqual([]);
    expect(() => {
      bindCliSkillModules(first, []);
    }).toThrow('already bound');
  });

  it('carries invocation contributions through an oclif config reload', () => {
    const original = { options: {} };
    bindCliSkillModules(original, [skillModule]);
    const reloaded = { options: { ...original.options } };

    expect(readCliSkillModules(reloaded)).toEqual([skillModule]);
    expect(readCliSkillModules({ options: {} })).toEqual([]);
  });
});
