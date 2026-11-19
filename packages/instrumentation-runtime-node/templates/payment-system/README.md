# Verify payment persistence

Alice submits a valid payment method. The approved rule requires HTTP 201 and exactly one matching succeeded intent in PostgreSQL. The test also records the Redis cache value and runtime effects. The reviewed snapshot replaces the returned intent ID with `<created-intent>`.

## Run the example

Use Node.js 22.22.2 or newer, npm, and a running Docker Engine with Compose. From your writable copy of this example, run:

```sh
npm install
npm exec -- blackbox inst install --runtime node
npm exec -- blackbox catalog validate --json
npm exec -- playwright test
npm exec -- playwright show-report
```

`package.json` pins the Blackbox packages to the same version as the package that supplied the example. The Node installer prepares the dependencies for the project-local bootstrap. Catalog validation checks the Compose file, activation file, participant references, and installed adapters. The native Playwright test starts the isolated payment API, PostgreSQL and Redis. Open `playwright-report/index.html` for the steps and assertions, or inspect `test-results/results.json` for the `blackbox-execution` and `effects.json` attachments.

## Connect a Node participant

The `payment-api` participant in `blackbox.config.yaml` declares `activation: payment-node`. The matching top-level entry selects `adapter: node-preload` and points `ref` to the regular file `.blackbox/instrumentation/instrumentation.js`. Use `node-preload` for a CommonJS application like `app/server.cjs`. For a Node application with ESM module imports, select `node-esm`; that adapter adds the OpenTelemetry loader and the bootstrap preload.

Place only application-owned flags in Compose. This example sets `NODE_OPTIONS: --enable-source-maps`. Blackbox mounts the activation files and appends its own flags when the Sandbox starts. Adding the same `--require` or loader flag to the application command would load instrumentation twice.

## Try the persistence defect

In `app/server.cjs`, remove the `INSERT INTO payment_intent` call, then rerun the unchanged test. The endpoint still returns 201 and updates Redis. The named assertion `And exactly that payment is persisted` fails because the PostgreSQL checkpoint has no matching row. Restore the insert and rerun. Each attempt uses a fresh Sandbox and the same reviewed snapshot.
