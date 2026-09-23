export interface SeedUser {
  readonly userId: string;
  readonly tier: 'pro';
  readonly executionPath: 'full' | 'local-only';
}

export const seedUsers = [
  { userId: 'alice', tier: 'pro', executionPath: 'full' },
  { userId: 'bob', tier: 'pro', executionPath: 'full' },
  { userId: 'carol', tier: 'pro', executionPath: 'full' },
  { userId: 'dora', tier: 'pro', executionPath: 'local-only' },
  { userId: 'eve', tier: 'pro', executionPath: 'local-only' },
] satisfies readonly SeedUser[];

const localOnlyUsers = new Set(
  seedUsers
    .filter(({ executionPath }) => executionPath === 'local-only')
    .map(({ userId }) => userId),
);

export function isLocalOnlyUser(userId: string): boolean {
  return localOnlyUsers.has(userId);
}

export function hintProfileFor(userId: string): 'short' | 'long' {
  return userId === 'bob' ? 'short' : 'long';
}
