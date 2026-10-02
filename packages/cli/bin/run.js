#!/usr/bin/env node
import { runCli } from '../dist/run.js';

await runCli(process.argv.slice(2));
