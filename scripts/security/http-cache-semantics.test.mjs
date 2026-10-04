import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

// Regression contract for upstream PR 58 at 14a8c2ad51740dc39bf3e8f1a11c845a5003f217.
// The patched dependency retains its upstream BSD-2-Clause license.
const require = createRequire(import.meta.url);
const explicitTarget = process.env.BLACKBOX_HTTP_CACHE_SEMANTICS_TARGET;

function loadCachePolicy() {
  if (explicitTarget !== undefined) {
    return require(resolve(explicitTarget));
  }
  const requireFromLerna = createRequire(require.resolve('lerna'));
  const requireFromMakeFetchHappen = createRequire(requireFromLerna.resolve('make-fetch-happen'));
  return requireFromMakeFetchHappen('http-cache-semantics');
}

const CachePolicy = loadCachePolicy();

const resource = 'https://cache.example.test/account';
const host = 'cache.example.test';

function request(cacheControl) {
  const headers = { host };
  if (cacheControl !== undefined) {
    headers['cache-control'] = cacheControl;
  }
  return { url: resource, method: 'GET', headers };
}

function policy({ cacheControl, headers = {}, shared = true, ageSeconds = 5 }) {
  const created = new CachePolicy(
    request(),
    {
      status: 200,
      headers: { 'cache-control': cacheControl, ...headers },
    },
    { shared },
  );
  const serialized = created.toObject();
  const observedAt = serialized.t;
  serialized.t -= ageSeconds * 1000;
  const restored = CachePolicy.fromObject(serialized);
  restored.now = () => observedAt;
  return restored;
}

function assertSynchronousMiss(candidate) {
  const incoming = request('max-stale=86400');
  const result = candidate.evaluateRequest(incoming);
  assert.equal(result.response, undefined);
  assert.equal(result.revalidation.synchronous, true);
  assert.equal(candidate.satisfiesWithoutRevalidation(incoming), false);
}

function assertCacheHit(candidate) {
  const incoming = request('max-stale=86400');
  const result = candidate.evaluateRequest(incoming);
  assert.notEqual(result.response, undefined);
  assert.equal(result.revalidation, undefined);
  assert.equal(candidate.satisfiesWithoutRevalidation(incoming), true);
}

for (const restricted of [
  {
    name: 'a shared Set-Cookie response without an explicit opt-in',
    input: { cacheControl: 'max-age=60', headers: { 'set-cookie': 'session=synthetic' } },
  },
  {
    name: 'a shared proxy-revalidate response',
    input: { cacheControl: 'max-age=60, proxy-revalidate' },
  },
  {
    name: 'a no-cache response',
    input: { cacheControl: 'max-age=60, no-cache' },
  },
  {
    name: 'a no-store response retained by a nonconforming caller',
    input: { cacheControl: 'max-age=60, no-store' },
  },
]) {
  test(`max-stale cannot reuse ${restricted.name}`, () => {
    assertSynchronousMiss(policy(restricted.input));
  });
}

test('max-stale can reuse an ordinarily stale response', () => {
  assertCacheHit(policy({ cacheControl: 'max-age=1' }));
});

for (const allowed of [
  {
    name: 'a shared Set-Cookie response explicitly marked public',
    input: {
      cacheControl: 'public, max-age=1',
      headers: { 'set-cookie': 'session=synthetic' },
    },
  },
  {
    name: 'a shared Set-Cookie response explicitly marked immutable',
    input: {
      cacheControl: 'immutable, max-age=1',
      headers: { 'set-cookie': 'session=synthetic' },
    },
  },
  {
    name: 'a private-cache Set-Cookie response',
    input: {
      cacheControl: 'max-age=1',
      headers: { 'set-cookie': 'session=synthetic' },
      shared: false,
    },
  },
]) {
  test(`max-stale preserves reuse of ${allowed.name}`, () => {
    assertCacheHit(policy(allowed.input));
  });
}

test('serialization preserves shared-cache reuse restrictions', () => {
  const candidate = policy({
    cacheControl: 'max-age=60',
    headers: { 'set-cookie': 'session=synthetic' },
  });
  const restored = CachePolicy.fromObject(candidate.toObject());
  restored.now = candidate.now;
  assertSynchronousMiss(restored);
});
