/** Give every owned client a bounded disposal opportunity, including after another hangs. */
export async function disposeWithinBudget(
  dispose: () => unknown,
  timeoutMs: number,
): Promise<void> {
  const timer = { handle: null as ReturnType<typeof setTimeout> | null };
  try {
    await Promise.race([
      Promise.resolve().then(dispose),
      new Promise<never>((_resolve, reject) => {
        timer.handle = setTimeout(() => {
          reject(new Error('Blackbox client disposal exceeded its cleanup budget'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer.handle !== null) {
      clearTimeout(timer.handle);
    }
  }
}
