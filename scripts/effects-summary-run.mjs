import { format, summarize } from './effects-summary.mjs';

const [path, flag] = process.argv.slice(2);
if (path === undefined) {
  process.stderr.write('usage: node scripts/effects-summary-run.mjs <results.json> [--json]\n');
  process.exit(2);
}
const summaries = await summarize(path);
process.stdout.write(
  flag === '--json' ? `${JSON.stringify(summaries, null, 2)}\n` : `${format(summaries)}\n`,
);
