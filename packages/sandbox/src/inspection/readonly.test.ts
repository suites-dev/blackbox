import { expect, it } from 'vitest';

import { composeContainer } from '../lifecycle/runtime.fixture.js';
import { immutableMap, inspectableContainer } from './container.js';
import { immutableResources } from './resources.js';

it('takes inspection snapshots without exposing mutable maps or backing driver state', () => {
  const labels = { owner: 'original' };
  const environment = { PRIVATE_TOKEN: 'original' };
  const networkNames = ['original-network'];
  const container = inspectableContainer({
    service: 'orders',
    container: { ...composeContainer(), labels, environment, networkNames },
    endpoints: [
      { name: 'http', service: 'orders', containerPort: 3000 },
      { name: 'db', service: 'postgres', containerPort: 5432 },
    ],
  });
  labels.owner = 'changed';
  environment.PRIVATE_TOKEN = 'changed';
  networkNames.push('foreign-network');
  expect(container.testcontainer.labels).toEqual({ owner: 'original' });
  expect(container.testcontainer.environment).toEqual({ PRIVATE_TOKEN: 'original' });
  expect(container.testcontainer.networkNames).toEqual(['original-network']);
  expect([...container.testcontainer.mappedPorts]).toEqual([[3000, 13_000]]);
  const source = new Map([['orders', container]]);
  const view = immutableMap(source);
  source.clear();
  expect(view.get('orders')).toBe(container);
  view.forEach((_value, _key, map) => {
    expect(map).toBe(view);
    expect('set' in map).toBe(false);
    expect('delete' in map).toBe(false);
    expect('clear' in map).toBe(false);
  });
  expect(() => Object.assign(container.testcontainer.labels, { owner: 'changed' })).toThrow();
  expect(() =>
    Object.assign(container.testcontainer.environment, { PRIVATE_TOKEN: 'changed' }),
  ).toThrow();
  expect(() => Object.assign(container.testcontainer, { host: 'foreign-host' })).toThrow();
});

it('freezes every resource projection without retaining driver-owned mutable lists', () => {
  const labels = { 'com.docker.compose.project': 'owned' };
  const networks = [{ id: 'network-id', name: 'owned_default', labels }];
  const volumes = [{ name: 'owned_data', labels }];
  const resources = immutableResources({
    projectName: 'owned',
    containers: new Map(),
    observed: { kind: 'owned-compose-resources', projectName: 'owned', networks, volumes },
  });
  networks.length = 0;
  volumes.length = 0;
  labels['com.docker.compose.project'] = 'foreign';
  expect(resources.networks[0].labels['com.docker.compose.project']).toBe('owned');
  expect(resources.volumes[0].labels['com.docker.compose.project']).toBe('owned');
  for (const value of [resources.containers, resources.volumes, resources.volumes[0]]) {
    expect(Object.isFrozen(value)).toBe(true);
  }
});
