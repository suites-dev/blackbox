import { verifyEffects } from './playwright-effects-proof.mjs';

// The entry point is its own file so the proof module needs no check on how it was started.
process.stdout.write(`${JSON.stringify(await verifyEffects(), null, 2)}\n`);
