import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { commandFixture, removeFixture } from '../capsule/reporting/capsule-command.fixture.js';
import { capsuleReportProvider } from './capsule-provider.js';
import { serveReport } from './serve.js';

void test('browser launch happens after readiness; opener failure preserves the listener and Capsule', async () => {
  const fixture = await commandFixture('running');
  const before = await readFile(join(fixture.artifactRoot, 'session.json'), 'utf8');
  const announced: string[] = [];
  const warnings: string[] = [];
  let servedStatus = 0;
  let sawAnnouncedUrl = false;
  const signalListeners = process.listenerCount('SIGINT');
  try {
    await serveReport({
      kind: 'serve-report',
      projectDirectory: fixture.directory,
      port: 0,
      provider: capsuleReportProvider({ projectDirectory: fixture.directory }),
      selection: { kind: 'report', type: 'capsule', id: fixture.sessionId },
      announce: ({ url }) => {
        announced.push(url);
      },
      browser: {
        kind: 'open',
        async launch({ url }) {
          sawAnnouncedUrl = announced[0] === url;
          servedStatus = (await fetch(url)).status;
          throw new Error('No browser installed');
        },
        warn({ message }) {
          warnings.push(message);
          process.emit('SIGINT');
        },
      },
    });
    assert.equal(sawAnnouncedUrl, true);
    assert.equal(servedStatus, 200);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes(announced[0]));
    await assert.rejects(fetch(announced[0]));
    assert.equal(await readFile(join(fixture.artifactRoot, 'session.json'), 'utf8'), before);
    assert.equal(process.listenerCount('SIGINT'), signalListeners);
  } finally {
    await removeFixture(fixture.directory);
  }
});
