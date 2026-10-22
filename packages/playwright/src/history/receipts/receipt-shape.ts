const lifecycleStates = new Set([
  'scheduled',
  'acquisition-failed',
  'execution-started',
  'execution-completed',
  'execution-interrupted',
  'evidence-unavailable',
]);

const digest = /^sha256:[0-9a-f]{64}$/u;

type Fields = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is Fields =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const isCount = (value: unknown): value is number => Number.isSafeInteger(value);
const isTextOrNull = (value: unknown): boolean => value === null || isText(value);

function section(
  root: Fields,
  name: string,
  rules: Readonly<Record<string, (v: unknown) => boolean>>,
) {
  const value = root[name];
  if (!isObject(value)) {
    return [name];
  }
  return Object.entries(rules)
    .filter(([field, valid]) => !valid(value[field]))
    .map(([field]) => `${name}.${field}`);
}

function lifecycleProblems(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    return ['lifecycle'];
  }
  const entries: unknown[] = value;
  return entries.every(
    (event) =>
      isObject(event) &&
      isText(event.state) &&
      lifecycleStates.has(event.state) &&
      isText(event.at) &&
      isText(event.detail),
  )
    ? []
    : ['lifecycle'];
}

/**
 * The fields a receipt must have, with the types the index and the queries rely on. A digest only shows the
 * bytes did not change after someone computed it, so a record is checked for shape before it is stored.
 */
export function receiptShapeProblems(receipt: Fields): string[] {
  return [
    ...section(receipt, 'attempt', {
      receiptId: isText,
      retry: isCount,
      retries: isCount,
      workerIndex: isCount,
      parallelIndex: isCount,
      sandboxId: isTextOrNull,
    }),
    ...section(receipt, 'test', {
      runnerTestId: isText,
      file: isText,
      project: isText,
      titlePath: (v) => Array.isArray(v) && (v as unknown[]).every(isText),
    }),
    ...section(receipt, 'system', { catalogEntryId: isText }),
    ...section(receipt, 'outcome', {
      testStatus: isText,
      expectedStatus: isText,
      errorCount: isCount,
    }),
    ...section(receipt, 'behavior', {
      id: isText,
      derivedId: isText,
      basis: (v) => v === 'declared' || v === 'derived',
      declaration: (v) => isObject(v) && isText(v.state),
    }),
    ...lifecycleProblems(receipt.lifecycle),
    ...(isTextOrNull(receipt.invocation) ? [] : ['invocation']),
    ...(receipt.failure === null ||
    (isObject(receipt.failure) && isText(receipt.failure.phase) && isText(receipt.failure.message))
      ? []
      : ['failure']),
    ...(receipt.envelope === null || (isText(receipt.envelope) && digest.test(receipt.envelope))
      ? []
      : ['envelope']),
  ].map((problem) => `shape: ${problem}`);
}
