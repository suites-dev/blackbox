#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { run, Errors, flush } from '@oclif/core';
import { discoverProjectCliPlugins } from '../dist/plugin-discovery.js';

try {
  const plugins = await discoverProjectCliPlugins(
    process.cwd(),
    fileURLToPath(new URL('..', import.meta.url)),
  );
  if (plugins !== null) {
    process.env.NODE_ENV ??= 'development';
  }
  await run(process.argv.slice(2), {
    root: fileURLToPath(new URL('..', import.meta.url)),
    pluginAdditions:
      plugins === null
        ? undefined
        : { core: [...plugins.names], dev: [...plugins.names], path: plugins.path },
  });
  await flush();
} catch (error) {
  if (error instanceof Errors.ExitError) await Errors.handle(error);
  else await Errors.handle(error);
}
