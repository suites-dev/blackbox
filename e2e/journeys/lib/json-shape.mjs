#!/usr/bin/env node
// The shape of one Blackbox --json document, for golden journeys. Reads stdin
// only and never reads its arguments, so a golden cannot pass it anything.
// Prints how many documents arrived, `kind`, every key path (never a value),
// `observation.status`, `context.kind`, the `limitations[].kind` list and
// `next`; the runner normalizes IDs as usual.
import { text } from 'node:stream/consumers';

import { jsonShape } from './json-shape-core.mjs';

try {
  console.log(jsonShape(await text(process.stdin)));
} catch (error) {
  console.error(`json-shape.mjs: ${error.message}`);
  process.exitCode = 1;
}
