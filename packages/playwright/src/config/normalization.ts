import type { BlackboxClients } from '../types.js';
import type { ClientRegistry } from '../clients/types.js';
import type { BlackboxAttemptOptions, BlackboxCatalogSelection } from './options.js';

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Blackbox ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function id(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Blackbox system id must be a non-empty string');
  }
  return value;
}

function selection(value: unknown): BlackboxCatalogSelection {
  if (value === undefined) { return { kind: 'unselected' }; }
  if (typeof value === 'string') { return { kind: 'catalog-entry', id: id(value) }; }
  const selected = object(value, 'system selection');
  if (selected.kind !== 'system' && selected.kind !== 'subsystem') {
    throw new Error('Blackbox system selection must identify a system or subsystem');
  }
  return { kind: selected.kind, id: id(selected.id) };
}

function boolean(value: unknown, fallback: boolean, name: string): boolean {
  if (value === undefined) { return fallback; }
  if (typeof value !== 'boolean') { throw new Error(`Blackbox ${name} must be a boolean`); }
  return value;
}

function environment(value: unknown): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(object(value === undefined ? {} : value, 'environment'))) {
    if (typeof entry !== 'string') {
      throw new Error(`Blackbox environment value ${JSON.stringify(key)} must be a string`);
    }
    Object.defineProperty(result, key, { value: entry, enumerable: true });
  }
  return Object.freeze(result);
}

function clients(value: unknown): ClientRegistry {
  const registry = object(value === undefined ? {} : value, 'clients');
  for (const [name, candidate] of Object.entries(registry)) {
    const definition = object(candidate, `client ${JSON.stringify(name)}`);
    const target = object(definition.target, `client ${JSON.stringify(name)} target`);
    if (typeof target.participant !== 'string' || target.participant.trim().length === 0 ||
      typeof target.containerPort !== 'number' || !Number.isInteger(target.containerPort) ||
      target.containerPort < 1 || target.containerPort > 65535) {
      throw new Error(`Blackbox client ${JSON.stringify(name)} requires a participant and valid container port`);
    }
    if (!Array.isArray(definition.env) || definition.env.some((key) => typeof key !== 'string') ||
      !['create', 'ready', 'dispose'].every((key) => typeof definition[key] === 'function')) {
      throw new Error(`Blackbox client ${JSON.stringify(name)} requires env, create, ready and dispose`);
    }
  }
  return Object.freeze({ ...registry }) as ClientRegistry;
}

export function normalizeBlackboxOptions(value: unknown): BlackboxAttemptOptions {
  const options = object(value, 'option');
  return {
    catalogEntry: selection(options.system),
    blackboxClients: clients(options.clients),
    blackboxEnvironment: environment(options.environment),
    blackboxRetainAttempts: boolean(options.retainAttempts, false, 'retainAttempts'),
    blackboxFinalSnapshot: boolean(options.finalSnapshot, true, 'finalSnapshot'),
  };
}

export function registeredClients(clients: Readonly<Record<string, unknown>>): Readonly<BlackboxClients> {
  return new Proxy(clients, {
    get(target, property, receiver) {
      if (typeof property === 'string' && !Reflect.has(target, property) && property !== 'then') {
        throw new Error(`Blackbox client ${JSON.stringify(property)} is not registered in this test's blackbox.clients option`);
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return value;
    },
  }) as Readonly<BlackboxClients>;
}
