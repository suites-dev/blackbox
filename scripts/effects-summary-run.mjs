import { format, summarize } from './effects-summary.mjs';

const [path = '', flag] = process.argv.slice(2);
try {
  const summaries = await summarize(path);
  process.stdout.write(
    flag === '--json' ? `${JSON.stringify(summaries, null, 2)}\n` : `${format(summaries)}\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `effects-summary: ${message}\nusage: node scripts/effects-summary-run.mjs <results.json> [--json]\n`,
  );
  process.exitCode = 2;
}
