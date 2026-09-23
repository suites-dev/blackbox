import { stdin } from 'node:process';

import { runCapsuleManager } from './manager.js';
import { nodeCapsuleManagerPorts } from './manager/ports.js';
import type { CapsuleManagerBootstrap } from './protocol.js';

async function readBootstrap(): Promise<CapsuleManagerBootstrap> {
  stdin.setEncoding('utf8');
  let bytes = '';
  for await (const chunk of stdin) {
    bytes += String(chunk);
  }
  if (bytes.length > 1_048_576) {
    throw new Error('Capsule manager bootstrap exceeds 1 MiB');
  }
  return JSON.parse(bytes) as CapsuleManagerBootstrap;
}

await runCapsuleManager(await readBootstrap(), nodeCapsuleManagerPorts);
