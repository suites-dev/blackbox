/** A leaf check, or a nested object of rules: the shape a record must have before anything reads it. */
export type Check = (value: unknown) => boolean;
export type Rule = Check | Rules;
/** Field name to the rule for its value; an object rule describes a nested object. */
export type Rules = Readonly<Record<string, Check | NestedRules>>;
interface NestedRules {
  readonly [field: string]: Check | NestedRules;
}

export type Fields = Readonly<Record<string, unknown>>;

export const isObject = (value: unknown): value is Fields =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export const isText = (value: unknown): value is string => typeof value === 'string';
export const isCount = (value: unknown): value is number => Number.isSafeInteger(value);
export const isFlag = (value: unknown): value is boolean => typeof value === 'boolean';
export const isTextOrNull = (value: unknown): boolean => value === null || isText(value);
export const isDigest = (value: unknown): boolean =>
  isText(value) && /^sha256:[0-9a-f]{64}$/u.test(value);
export const isDigestOrNull = (value: unknown): boolean => value === null || isDigest(value);
export const isList = (value: unknown): boolean => Array.isArray(value);

export const listOf =
  (rule: Rule) =>
  (value: unknown): boolean =>
    Array.isArray(value) && (value as unknown[]).every((item) => holds(item, rule));
export const oneOf =
  (...allowed: readonly string[]) =>
  (value: unknown): boolean =>
    isText(value) && allowed.includes(value);

function holds(value: unknown, rule: Rule): boolean {
  return typeof rule === 'function' ? rule(value) : shapeProblems(value, rule).length === 0;
}

/** The dotted paths of every field that is missing or has the wrong type. */
export function shapeProblems(value: unknown, rules: Rules): string[] {
  if (!isObject(value)) {
    return [''];
  }
  return Object.entries(rules).flatMap(([field, rule]) => {
    const inner = value[field];
    if (typeof rule === 'function') {
      return rule(inner) ? [] : [field];
    }
    const nested = shapeProblems(inner, rule);
    return nested.map((path) => (path === '' ? field : `${field}.${path}`));
  });
}
