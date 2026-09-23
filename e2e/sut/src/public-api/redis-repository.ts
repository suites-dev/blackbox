import type { RedisConnection } from '../lib/redis.js';

export class RedisRepository {
  readonly #client: RedisConnection;

  constructor(client: RedisConnection) {
    this.#client = client;
  }

  getTier(userId: string): Promise<string | null> {
    return this.#client.get(`user:${userId}:tier`);
  }

  async setTier(userId: string, tier: string): Promise<void> {
    await this.#client.set(`user:${userId}:tier`, tier, { EX: 300 });
  }

  getHint(key: string): Promise<string | null> {
    return this.#client.get(key);
  }

  async setHint(key: string, value: string): Promise<void> {
    await this.#client.set(key, value);
  }

  async reset(profile: 'fresh' | 'comparison-absent' | 'comparison-returning'): Promise<void> {
    await this.#client.flushDb();
    if (profile === 'comparison-returning') {
      await this.#client.set('hint:returning:eve', '1');
    }
  }

  async inspect(): Promise<Readonly<Record<string, string | null>>> {
    const keys = (await this.#client.keys('*')).sort();
    const values = keys.length === 0 ? [] : await this.#client.mGet(keys);
    return Object.fromEntries(keys.map((key, index) => [key, values[index] ?? null]));
  }
}
