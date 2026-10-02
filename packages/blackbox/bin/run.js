#!/usr/bin/env node
import { runCli } from '@suites/blackbox-cli/run';

await runCli(process.argv.slice(2), { installationDirectory: new URL('../', import.meta.url) });
