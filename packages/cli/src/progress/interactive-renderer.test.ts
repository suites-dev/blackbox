import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CapsuleProgressEvent,
  CapsuleAcquisitionObservation,
} from '@suites/blackbox-capsule-internal';
import { InteractiveProgressRenderer } from './interactive-renderer.js';
import { TerminalScreen } from './terminal-screen.fixture.js';

const base = {
  sessionId: 'quiet-river-ada',
  sequence: 1,
  at: 'now',
  stage: 'acquisition',
} as const;
const service = {
  kind: 'service-state',
  participant: 'postgres',
  container: {
    service: 'db',
    containerId: 'id',
    containerName: 'owned-db',
    state: 'created',
    health: 'starting',
    termination: { kind: 'none' },
  },
} satisfies CapsuleAcquisitionObservation;
function fixture() {
  const screen = new TerminalScreen(100);
  const renderer = new InteractiveProgressRenderer({
    color: false,
    write: (text) => {
      screen.write(text);
    },
    viewport: () => ({ columns: 100, rows: 24 }),
    now: Date.now,
  });
  return {
    screen,
    renderer,
    observe: (observation: CapsuleAcquisitionObservation) => {
      renderer.sink({ ...base, kind: 'acquisition-observation', observation });
    },
  };
}

void test('keeps spinner above stable rows and replaces service/resource states in place', (context) => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  const { screen, renderer, observe } = fixture();
  try {
    renderer.sink({ ...base, kind: 'acquisition-started', projectName: 'hidden-project' });
    observe(service);
    assert.match(
      screen.text(),
      /user output\n[⠋⠙⠹⠸] Acquiring capsule.*\n {2}[⠋⠙⠹⠸] postgres — created/u,
    );
    const initial = screen.text();
    context.mock.timers.tick(100);
    assert.notEqual(screen.text(), initial);
    observe({
      ...service,
      container: { ...service.container, state: 'running', health: 'healthy' },
    });
    assert.equal(screen.text().match(/postgres/gu)!.length, 1);
    assert.match(screen.text(), /✓ postgres — healthy \(Docker\)/u);
    assert.doesNotMatch(screen.text(), /created|application ready|Capsule ready/u);
    observe({ kind: 'resource-discovered', resource: { kind: 'network', name: 'owned-net' } });
    renderer.sink({
      ...base,
      kind: 'resource-owned',
      resource: { kind: 'network', name: 'owned-net' },
    });
    assert.equal(screen.text().match(/owned-net/gu)!.length, 1);
    assert.match(screen.text(), /owned-net — owned/u);
    assert.equal(screen.wraps, 0);
  } finally {
    renderer.finish();
  }
});

void test('keeps independent application readiness pending after a healthy Docker observation', () => {
  const { screen, renderer, observe } = fixture();
  observe({ ...service, container: { ...service.container, state: 'running', health: 'healthy' } });
  renderer.sink({
    ...base,
    kind: 'container-acquired',
    participant: 'postgres',
    service: 'db',
    containerId: 'id',
    containerName: 'owned-db',
    networkNames: [],
  });
  renderer.sink({
    ...base,
    stage: 'readiness',
    kind: 'readiness-started',
    url: 'http://localhost/health',
    timeoutMs: 5000,
  });
  assert.match(screen.text(), /Checking application readiness/u);
  assert.match(screen.text(), /healthy \(Docker\); Testcontainers checks passed/u);
  assert.match(screen.text(), /[⠋⠙⠹⠸] Application readiness — checking/u);
  assert.doesNotMatch(screen.text(), /✓ Application readiness/u);
  renderer.sink({
    ...base,
    stage: 'readiness',
    kind: 'readiness-succeeded',
    url: 'http://localhost/health',
    durationMs: 50,
  });
  renderer.sink({ ...base, stage: 'ready', kind: 'capsule-ready', durationMs: 80 });
  assert.match(screen.text(), /user output\n✓ Capsule ready/u);
  assert.match(screen.text(), /✓ Application readiness — ready/u);
  assert.doesNotMatch(screen.text(), /[⠋⠙⠹⠸]/u);
});

void test('keeps observation outages/recovery visible and failure final without a false stage success', (context) => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  const { screen, renderer, observe } = fixture();
  observe(service);
  observe({ kind: 'observation-status', status: 'unavailable' });
  assert.match(screen.text(), /Docker progress unavailable/u);
  observe({ kind: 'observation-status', status: 'available' });
  assert.doesNotMatch(screen.text(), /progress unavailable/u);
  assert.match(screen.text(), /observation resumed/u);
  renderer.sink({
    ...base,
    kind: 'capsule-start-failed',
    stage: 'persistence',
    cause: { name: 'Error', message: 'disk full' },
  });
  assert.match(screen.text(), /✗ Capsule start failed — persistence/u);
  assert.match(screen.text(), /disk full/u);
  assert.doesNotMatch(screen.text(), /✓|[⠋⠙⠹⠸]/u);
  const writes = screen.writes;
  context.mock.timers.tick(5000);
  renderer.finish();
  renderer.sink({ ...base, kind: 'capsule-ready', durationMs: 1 });
  assert.equal(screen.writes, writes);
});

void test('interruption freezes last observed states and stops the animation', (context) => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  const { screen, renderer, observe } = fixture();
  observe(service);
  renderer.finish();
  assert.match(screen.text(), /observation ended before Capsule readiness/u);
  assert.match(screen.text(), /• postgres — created/u);
  assert.doesNotMatch(screen.text(), /[⠋⠙⠹⠸]|✓/u);
  const writes = screen.writes;
  context.mock.timers.tick(5000);
  assert.equal(screen.writes, writes);
});

void test('all setup events occupy a single updating block and waiting uses retained elapsed time', () => {
  const { screen, renderer } = fixture();
  const events = [
    {
      ...base,
      kind: 'session-admitted',
      system: 'orders',
      artifactRoot: '/private',
      environmentKeys: ['TOKEN'],
    },
    { ...base, kind: 'manager-spawned', managerPid: 42 },
    { ...base, kind: 'catalog-selected', system: 'orders', configFile: '/private' },
    {
      ...base,
      kind: 'catalog-resolved',
      system: 'orders',
      projectDirectory: '/private',
      composeFiles: [],
      services: ['db'],
    },
    { ...base, kind: 'manager-ready', managerPid: 42 },
    { ...base, kind: 'compose-configured', projectName: 'hidden' },
    { ...base, kind: 'acquisition-started', projectName: 'hidden' },
    {
      ...base,
      kind: 'acquisition-observation',
      observation: { kind: 'waiting', elapsedMs: 10_000 },
    },
    {
      ...base,
      kind: 'endpoint-mapped',
      endpoint: { url: 'http://localhost', host: 'localhost', port: 80, protocol: 'http' },
    },
  ] satisfies CapsuleProgressEvent[];
  try {
    for (const event of events) {
      renderer.sink(event);
    }
    assert.match(screen.text(), /10s elapsed/u);
    assert.match(screen.text(), /✓ Manager — ready/u);
    assert.match(screen.text(), /db — awaiting container/u);
    assert.match(screen.text(), /✓ Entrypoint — http/u);
    assert.doesNotMatch(screen.text(), /private|hidden|manager spawned/u);
  } finally {
    renderer.finish();
  }
});

void test('a service failure changes its row without reordering neighbouring resources', () => {
  const { screen, renderer, observe } = fixture();
  try {
    observe(service);
    observe({
      ...service,
      participant: 'redis',
      container: { ...service.container, service: 'redis' },
    });
    const before = screen
      .text()
      .split('\n')
      .findIndex((line) => line.includes('redis —'));
    observe({
      ...service,
      participant: 'redis',
      container: { ...service.container, service: 'redis', state: 'running', health: 'unhealthy' },
    });
    const after = screen
      .text()
      .split('\n')
      .findIndex((line) => line.includes('redis —'));
    assert.equal(after, before);
    assert.match(screen.text(), /✗ redis — running; Docker health: unhealthy/u);
  } finally {
    renderer.finish();
  }
});
