import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertionChild } from './playwright-assertions-child.mjs';
import { assertionServer } from './playwright-assertions-server.mjs';
import { verifyAssertionReport, verifyAssertionRequests } from './playwright-assertions-proof.mjs';

const consumer = dirname(fileURLToPath(import.meta.url));
const results = join(consumer, 'test-results/assertions');
const requests = [];
const paths = [
  '/positive',
  '/empty',
  '/swallowed',
  '/soft',
  '/async',
  '/async-poll',
  '/isolation-positive',
  '/isolation-empty',
];
const { server, close } = assertionServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  requests.push({ method: request.method, path });
  response.setHeader('content-type', 'application/json');
  if (request.method !== 'GET' || !paths.includes(path)) {
    response.writeHead(404).end('{"error":"unknown assertion fixture request"}');
    return;
  }
  const samples = requests.filter((item) => item.path === '/async-poll').length;
  response.end(JSON.stringify({ tenant: path.slice(1), ready: samples >= 3 }));
});

async function packageBoundary() {
  const packageRoot = await realpath(join(consumer, 'node_modules/@suites/blackbox-playwright'));
  const entrypoint = fileURLToPath(import.meta.resolve('@suites/blackbox-playwright'));
  const difference = relative(consumer, packageRoot);
  assert(
    difference !== '' && !difference.startsWith('..') && !isAbsolute(difference),
    'Assertion adapter escaped the independent packed consumer',
  );
  assert(
    entrypoint.startsWith(`${packageRoot}/dist/`),
    'Accounting API must use the packed public entrypoint',
  );
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  const runner = JSON.parse(
    await readFile(join(consumer, 'node_modules/@playwright/test/package.json'), 'utf8'),
  );
  const consumerManifest = JSON.parse(await readFile(join(consumer, 'package.json'), 'utf8'));
  assert.equal(runner.version, '1.64.1');
  assert.equal(consumerManifest.dependencies['@playwright/test'], runner.version);
  assert.equal(manifest.version, consumerManifest.dependencies['@suites/blackbox-playwright']);
  return { packageRoot, entrypoint, version: manifest.version, playwright: runner.version };
}

await mkdir(results, { recursive: false });
let child;
let listening = false;
let closed = false;
let forced = false;
let failure;
let proof;
let exitCode;
let interrupted = false;
const interrupt = () => {
  interrupted = true;
  child?.interrupt();
};
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);
try {
  const boundary = await packageBoundary();
  await writeFile(join(results, 'package-boundary.json'), JSON.stringify(boundary, null, 2));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  listening = true;
  assert.equal(interrupted, false, 'Assertion consumer interrupted during setup');
  const address = server.address();
  assert(address !== null && typeof address !== 'string' && address.address === '127.0.0.1');
  child = assertionChild(consumer, results, {
    BLACKBOX_ASSERTION_RESULTS: results,
    BLACKBOX_ASSERTION_ENDPOINT: `http://127.0.0.1:${address.port}`,
  });
  const arguments_ = ['test', '--config', join(consumer, 'playwright-assertions.config.ts')];
  assert.equal(await child.run([...arguments_, '--list', '--reporter=line'], 'discovery.txt'), 0);
  exitCode = await child.run(arguments_, 'execution.txt');
  const report = JSON.parse(await readFile(join(results, 'results.json'), 'utf8'));
  proof = {
    ...verifyAssertionReport(report, exitCode),
    requests: verifyAssertionRequests(requests),
    boundary,
  };
} catch (error) {
  failure = error;
} finally {
  if (listening) {
    try {
      ({ closed, forced } = await close());
    } catch (error) {
      failure = failure === undefined ? error : new AggregateError([failure, error]);
    }
  }
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', interrupt);
  if (interrupted && failure === undefined) failure = new Error('Assertion consumer interrupted');
  await writeFile(
    join(results, 'cleanup.json'),
    JSON.stringify({ listener: '127.0.0.1', listening, closed, forced, requests }, null, 2),
  );
  await writeFile(
    join(results, 'run-result.json'),
    JSON.stringify(
      {
        exitCode,
        status: failure === undefined ? 'verified' : 'failed',
        error: failure?.message,
        interrupted: child?.interrupted ?? false,
      },
      null,
      2,
    ),
  );
}
if (failure !== undefined) throw failure;
assert(closed, 'Assertion consumer fixture listener was not closed');
assert.equal(child.interrupted, false);
await writeFile(
  join(results, 'receipt.json'),
  JSON.stringify({ ...proof, cleanup: { listenerClosed: closed } }, null, 2),
);
console.log(
  'Packed assertion accounting: six cases, seven scopes; three expected misuse failures verified; loopback listener closed',
);
