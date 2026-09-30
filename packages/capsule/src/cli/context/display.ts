import { stripHyphens } from './identifiers.js';

/**
 * The display form of an activity ID: its first 8 hex characters, or, when
 * that is not unique in the project, the shortest longer prefix of the
 * canonical hyphenated UUID that is (for example `3f9a2c41-7b`). Every form
 * printed here is accepted back by the resolver.
 */
export function shortActivityId(activityId: string, projectActivityIds: readonly string[]): string {
  const others = projectActivityIds
    .filter((candidate) => candidate !== activityId)
    .map((candidate) => stripHyphens(candidate));
  const unique = (prefix: string): boolean => {
    const hex = stripHyphens(prefix);
    return others.every((candidate) => !candidate.startsWith(hex));
  };
  const first = activityId.slice(0, 8);
  if (unique(first)) {
    return first;
  }
  for (let length = 10; length <= activityId.length; length += 1) {
    const prefix = activityId.slice(0, length);
    if (!prefix.endsWith('-') && unique(prefix)) {
      return prefix;
    }
  }
  return activityId;
}

export class ActivityDisplay {
  readonly #ids: readonly string[];

  constructor(projectActivityIds: readonly string[]) {
    this.#ids = projectActivityIds;
  }

  short(activityId: string): string {
    return shortActivityId(activityId, this.#ids);
  }
}
