import { setTimeout as delay } from 'node:timers/promises';
import type { ComposeAcquisitionObservation, ComposeObservationMode, ComposeObservationSnapshot } from './observation.js';

interface StartupObserverInput {
  readonly mode: ComposeObservationMode;
  readonly inspect: (input: { readonly signal: AbortSignal }) => Promise<ComposeObservationSnapshot>;
  readonly now: () => number;
  readonly intervalMs: number;
}

/** Observe alongside up(); stopping aborts both the HTTP requests and the polling delay. */
export function observeComposeStartup(input: StartupObserverInput): { readonly stop: () => Promise<void> } {
  if (input.mode.kind === 'silent') { return { stop: () => Promise.resolve() }; }
  const controller = new AbortController();
  const started = input.now();
  const seen = new Map<string, string>();
  let available: boolean | undefined;
  let lastWaiting = started - 5_000;
  const emit = (event: ComposeAcquisitionObservation): void => {
    if (controller.signal.aborted || input.mode.kind === 'silent') { return; }
    try { input.mode.emit(event); } catch { /* A display failure cannot change acquisition truth. */ }
  };
  const poll = async (): Promise<void> => {
    try {
      const snapshot = await input.inspect({ signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2_000)]) });
      if (available === false) { emit({ kind: 'observation-status', status: 'available' }); }
      available = true;
      publishChanges({ snapshot, seen, emit });
    } catch {
      if (available !== false) { emit({ kind: 'observation-status', status: 'unavailable' }); }
      available = false;
    }
    if (input.now() - lastWaiting >= 5_000) {
      emit({ kind: 'waiting', elapsedMs: Math.max(0, input.now() - started) });
      lastWaiting = input.now();
    }
  };
  const running = (async () => {
    while (!controller.signal.aborted) {
      await poll();
      await delay(input.intervalMs, undefined, { signal: controller.signal }).catch(() => undefined);
    }
  })();
  return { stop: async () => { controller.abort(); await running; } };
}

function publishChanges(input: {
  readonly snapshot: ComposeObservationSnapshot;
  readonly seen: Map<string, string>;
  readonly emit: (event: ComposeAcquisitionObservation) => void;
}): void {
  for (const container of input.snapshot.containers) {
    const key = `container:${container.containerId}`;
    const signature = JSON.stringify(container);
    if (input.seen.get(key) !== signature) {
      input.seen.set(key, signature);
      input.emit({ kind: 'service-state', container });
    }
  }
  for (const resource of input.snapshot.resources) {
    const key = `${resource.kind}:${resource.name}`;
    if (!input.seen.has(key)) {
      input.seen.set(key, key);
      input.emit({ kind: 'resource-discovered', resource });
    }
  }
}
