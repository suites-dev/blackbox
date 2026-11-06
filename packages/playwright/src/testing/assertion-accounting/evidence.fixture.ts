export function record(kind: string, value: unknown): void {
  process.stdout.write(`BLACKBOX_ASSERTION_SCOPE_EVENT ${JSON.stringify({ kind, value })}\n`);
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
