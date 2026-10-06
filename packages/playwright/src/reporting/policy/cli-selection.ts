/**
 * Test selection given on the `playwright test` command line. FullConfig.grep and the
 * project greps hold only the config file's values: a CLI `--grep`, `--project` or file
 * filter reaches the reporter only through `argv`, so it is parsed here to be printed and
 * compared like every other policy input.
 */
export interface CliSelection {
  /** `-g, --grep`; Playwright keeps the last one. */
  readonly grep: string | null;
  /** `-G, --grep-invert`; Playwright keeps the last one. */
  readonly grepInvert: string | null;
  /** `--project`, every name in order. */
  readonly projects: readonly string[];
  /** Positional `[test-filter...]` arguments, such as `checkout.spec.ts:42`. */
  readonly testFilters: readonly string[];
  readonly lastFailed: boolean;
  readonly lastFailedFile: string | null;
  /** `--only-changed [ref]`: null when absent, `"HEAD"` when given without a ref. */
  readonly onlyChanged: string | null;
  readonly testList: string | null;
  readonly testListInvert: string | null;
  /** `--no-deps`: project dependencies are not run. */
  readonly noDeps: boolean;
}

type Arity = 'none' | 'required' | 'optional' | 'variadic';

/** Every `playwright test` option (1.63), so option values are never taken for test filters. */
const options = new Map<string, Arity>([
  ['--add-reporter', 'required'],
  ['--browser', 'required'],
  ['-c', 'required'],
  ['--config', 'required'],
  ['--debug', 'optional'],
  ['--fail-on-flaky-tests', 'none'],
  ['--forbid-only', 'none'],
  ['--fully-parallel', 'none'],
  ['--global-timeout', 'required'],
  ['-g', 'required'],
  ['--grep', 'required'],
  ['-G', 'required'],
  ['--grep-invert', 'required'],
  ['--headed', 'none'],
  ['--ignore-snapshots', 'none'],
  ['--last-failed', 'none'],
  ['--last-failed-file', 'required'],
  ['--list', 'none'],
  ['--max-failures', 'required'],
  ['--no-deps', 'none'],
  ['--output', 'required'],
  ['--only-changed', 'optional'],
  ['--pass-with-no-tests', 'none'],
  ['--project', 'variadic'],
  ['--quiet', 'none'],
  ['--repeat-each', 'required'],
  ['--reporter', 'required'],
  ['--retries', 'required'],
  ['--run-agents', 'optional'],
  ['--shard', 'required'],
  ['--test-list', 'required'],
  ['--test-list-invert', 'required'],
  ['--timeout', 'required'],
  ['--trace', 'required'],
  ['--tsconfig', 'required'],
  ['--ui', 'none'],
  ['--ui-host', 'required'],
  ['--ui-port', 'required'],
  ['-u', 'optional'],
  ['--update-snapshots', 'optional'],
  ['--update-source-method', 'required'],
  ['-j', 'required'],
  ['--workers', 'required'],
  ['-x', 'none'],
]);

const aliases = new Map([
  ['-g', '--grep'],
  ['-G', '--grep-invert'],
]);

/** The options and values given after `playwright test`, before any `--`. */
function testArguments(argv: readonly string[]): readonly string[] {
  const command = argv.indexOf('test', 2);
  const rest = command === -1 ? [] : argv.slice(command + 1);
  const dashDash = rest.indexOf('--');
  return dashDash === -1 ? rest : rest.slice(0, dashDash);
}

/** Splits `--grep=x` and `-gx` into a name and an inline value. */
function optionParts(argument: string): { readonly name: string; readonly inline: string | null } {
  if (argument.startsWith('--')) {
    const equals = argument.indexOf('=');
    return equals === -1
      ? { name: argument, inline: null }
      : { name: argument.slice(0, equals), inline: argument.slice(equals + 1) };
  }
  if (argument.length > 2 && options.get(argument.slice(0, 2)) !== 'none') {
    return { name: argument.slice(0, 2), inline: argument.slice(2) };
  }
  return { name: argument, inline: null };
}

/** Parses the test-selection flags out of `FullConfig.argv`. */
export function cliSelection(argv: readonly string[]): CliSelection {
  const values = new Map<string, string[]>();
  const testFilters: string[] = [];
  const args = testArguments(argv);
  const record = (name: string, value: string): void => {
    const key = aliases.get(name) ?? name;
    values.set(key, [...(values.get(key) ?? []), value]);
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith('-') || argument === '-') {
      testFilters.push(argument);
      continue;
    }
    const { name, inline } = optionParts(argument);
    const arity = options.get(name) ?? 'none';
    if (inline !== null || arity === 'none') {
      record(name, inline ?? '');
      continue;
    }
    const takesNext = (): boolean => index + 1 < args.length && !args[index + 1].startsWith('-');
    if (arity === 'required') {
      // commander takes the next argument even when it starts with a dash.
      if (index + 1 < args.length) {
        index += 1;
        record(name, args[index]);
      }
    } else if (arity === 'optional') {
      record(name, takesNext() ? args[(index += 1)] : '');
    } else {
      while (takesNext()) {
        index += 1;
        record(name, args[index]);
      }
    }
  }
  const last = (name: string): string | null => {
    const given = values.get(name);
    return given === undefined ? null : given[given.length - 1];
  };
  const onlyChanged = last('--only-changed');
  return {
    grep: last('--grep'),
    grepInvert: last('--grep-invert'),
    projects: values.get('--project') ?? [],
    testFilters,
    lastFailed: values.has('--last-failed'),
    lastFailedFile: last('--last-failed-file'),
    onlyChanged: onlyChanged === '' ? 'HEAD' : onlyChanged,
    testList: last('--test-list'),
    testListInvert: last('--test-list-invert'),
    noDeps: values.has('--no-deps'),
  };
}
