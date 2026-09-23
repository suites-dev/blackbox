import { randomInt, randomUUID } from 'node:crypto';

const ADJECTIVES = [
  'bright',
  'calm',
  'clever',
  'flying',
  'gentle',
  'quiet',
  'rapid',
  'steady',
] as const;
const NOUNS = [
  'comet',
  'harbor',
  'meadow',
  'river',
  'suite',
  'summit',
  'willow',
  'workshop',
] as const;
const NAMES = ['ada', 'alex', 'grace', 'jacob', 'linus', 'maya', 'noah', 'zoe'] as const;

function choose<const Values extends readonly string[]>(values: Values): Values[number] {
  return values[randomInt(values.length)];
}

export interface CapsuleIdentity {
  readonly sessionId: string;
  readonly executionId: string;
}

export function generateCapsuleIdentity(): CapsuleIdentity {
  return {
    sessionId: `${choose(ADJECTIVES)}-${choose(NOUNS)}-${choose(NAMES)}`,
    executionId: randomUUID(),
  };
}
