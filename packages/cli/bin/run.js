#!/usr/bin/env node
import { run, Errors, flush } from '@oclif/core';

try {
  await run(process.argv.slice(2), { root: new URL('..', import.meta.url).pathname });
  await flush();
} catch (error) {
  if (error instanceof Errors.ExitError) await Errors.handle(error);
  else await Errors.handle(error);
}
