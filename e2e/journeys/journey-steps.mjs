// Executes parsed golden items in one bash session.
import { defaultTimeout, shellQuote } from './journey-format.mjs';

/**
 * Runs commands in order. `#! capture` reads the previous command's RAW output
 * (never re-running anything) and fails the journey when it does not match;
 * `#! timeout` applies to the next command only. `raw` receives each command
 * with its un-normalized output and status; `executed` receives every item
 * completed so far, so a journey that aborts still leaves a partial transcript.
 */
export async function runItems({ items, session, raw, executed = [] }) {
  let previous = null;
  let timeout = null;
  for (const item of items) {
    if (item.kind === 'timeout') {
      timeout = item.milliseconds;
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
