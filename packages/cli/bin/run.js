#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { run, Errors, flush } from '@oclif/core';

try {
  await run(process.argv.slice(2), { root: fileURLToPath(new URL('..', import.meta.url)) });
  await flush();
} catch (error) {
  if (error instanceof Errors.ExitError) await Errors.handle(error);
  else await Errors.handle(error);
}
