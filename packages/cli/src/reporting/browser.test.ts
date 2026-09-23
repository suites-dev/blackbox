import assert from 'node:assert/strict';
import test from 'node:test';
import { browserCommand } from './browser.js';

void test('browser launch preserves the exact URL as an argument without a shell', () => {
  const url = 'http://127.0.0.1:4321/?type=capsule&id=quiet-river-ada';
  for (const [platform, executable, args] of [
    ['darwin', 'open', [url]], ['linux', 'xdg-open', [url]],
    ['win32', 'rundll32.exe', ['url.dll,FileProtocolHandler', url]],
  ] as const) {
    assert.deepEqual(browserCommand({ kind: 'open-browser', platform, url }), { kind: 'command', executable, args });
  }
  assert.deepEqual(browserCommand({ kind: 'open-browser', platform: 'unknown', url }), { kind: 'unsupported', platform: 'unknown' });
  for (const invalid of ['https://example.com/', 'file:///etc/passwd', 'http://localhost/']) {
    assert.throws(() => browserCommand({ kind: 'open-browser', platform: 'darwin', url: invalid }), /local report URL/u);
  }
});
