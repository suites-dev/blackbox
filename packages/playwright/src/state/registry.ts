import { StateSelectionImpl } from './selection.js';
import type { Entry } from './internal.js';
import type {
  BlackboxState,
  StateObserver,
  StateReaders,
  StateRegistry,
  StateSelection,
} from './types.js';

function nameValid(name: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/u.test(name);
}

export function createStateRegistry(): StateRegistry {
  let closed = false;
  const entries: Entry[] = [];
  function active(): void {
    if (closed) {
      throw new Error('State attempt has expired');
    }
  }
  const state = {
    observe<R extends StateReaders>(name: string, readers: R): StateObserver<R> {
      active();
      if (
        entries.length >= 100 ||
        !nameValid(name) ||
        entries.some((entry) => entry.name === name)
      ) {
        throw new Error('Invalid or duplicate state observer name');
      }
      const pairs = Object.entries(readers);
      if (
        pairs.length === 0 ||
        pairs.length > 100 ||
        pairs.some(([key, value]) => !nameValid(key) || typeof value !== 'function')
      ) {
        throw new Error('Invalid state readers');
      }
      const handle = Object.freeze({});
      entries.push({ name, readers: Object.freeze(pairs), handle });
      return handle as StateObserver<R>;
    },
  } satisfies BlackboxState;
  function select(): StateSelection {
    active();
    return new StateSelectionImpl([...entries], active);
  }
  return Object.freeze({
    state: Object.freeze(state),
    select,
    close: () => {
      closed = true;
    },
  });
}
