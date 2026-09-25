function freezeNested<T>(value: T): Readonly<T> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Reflect.ownKeys(value)) {
    freezeNested(Reflect.get(value, key));
  }
  return Object.freeze(value);
}

export function cloneAndFreeze<T>(value: T): Readonly<T> {
  return freezeNested(structuredClone(value));
}
