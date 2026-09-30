// Executes parsed golden items in one bash session.
import { setTimeout as sleep } from 'node:timers/promises';

import {
  DEFAULT_TIMEOUT_MS,
  WAIT_INTERVAL_MS,
  defaultTimeout,
  shellQuote,
} from './journey-format.mjs';

/**
 * `#! wait`: reruns a read-only command until its RAW output contains the
 * literal text, or fails the journey once the wait's own timeout has passed.
 * Its output is never compared and never feeds a capture.
 */
async function waitFor({ item, session, raw, now = Date.now, pause = sleep }) {
  const deadline = now() + item.milliseconds;
  for (;;) {
    // A single poll never outlives the wait by more than one interval.
    const result = await session.run(item.command, Math.max(deadline - now(), WAIT_INTERVAL_MS));
    raw.push(`$ ${item.command}  # wait\n${result.output}[status ${String(result.status)}]\n`);
    if (result.output.includes(item.text)) return;
    const remaining = deadline - now();
    if (remaining <= 0) {
      throw new Error(
        `wait for ${JSON.stringify(item.text)} timed out after ${String(item.milliseconds)} ms: ${item.command}`,
      );
    }
    // The last poll lands on the deadline itself.
    await pause(Math.min(WAIT_INTERVAL_MS, remaining));
  }
}

/**
 * Runs commands in order. `#! capture` reads the previous command's RAW output
 * (never re-running anything) and fails the journey when it does not match;
 * `#! timeout` applies to the next command only. `raw` receives each command
 * with its un-normalized output and status; `executed` receives every item
 * completed so far, so a journey that aborts still leaves a partial transcript.
 */
export async function runItems({ items, session, raw, executed = [], clock = {} }) {
  let previous = null;
  let timeout = null;
  for (const item of items) {
    if (item.kind === 'timeout') {
      timeout = item.milliseconds;
      executed.push(item);
      continue;
    }
    if (item.kind === 'wait') {
      await waitFor({ item, session, raw, ...clock });
      executed.push(item);
      continue;
    }
    if (item.kind === 'capture') {
      const match = previous === null ? null : item.pattern.exec(previous.output);
      if (match === null || match[1] === undefined) {
        throw new Error(`capture ${item.variable} did not match the previous output`);
      }
      await session.run(`${item.variable}=${shellQuote(match[1])}`, 10_000);
      executed.push(item);
      continue;
    }
    const result = await session.run(item.command, timeout ?? defaultTimeout(item.command));
    timeout = null;
    raw.push(`$ ${item.command}\n${result.output}[status ${String(result.status)}]\n`);
    previous = { ...item, output: result.output };
    executed.push(previous);
  }
  return executed;
}
