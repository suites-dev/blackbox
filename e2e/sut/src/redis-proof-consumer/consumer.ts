export const redisProofList = 'blackbox:proof:stimuli';

export interface RedisProofSource {
  take(): Promise<string>;
  close(): Promise<void>;
}

export interface RedisProofSink {
  deliver(proofId: string): Promise<void>;
}

type ConsumerState =
  | { readonly kind: 'ready' }
  | { readonly kind: 'running' }
  | { readonly kind: 'stopping' }
  | { readonly kind: 'stopped' };

export class RedisProofConsumer {
  readonly #source: RedisProofSource;
  readonly #sink: RedisProofSink;
  #state: ConsumerState = { kind: 'ready' };

  constructor(input: { readonly source: RedisProofSource; readonly sink: RedisProofSink }) {
    this.#source = input.source;
    this.#sink = input.sink;
  }

  async run(): Promise<void> {
    if (this.#state.kind !== 'ready') {
      throw new Error(`Redis proof consumer cannot run from ${this.#state.kind}`);
    }
    this.#state = { kind: 'running' };
    try {
      while (this.#state.kind === 'running') {
        await this.consumeOne();
      }
    } finally {
      this.#state = { kind: 'stopping' };
      await this.#source.close();
      this.#state = { kind: 'stopped' };
    }
  }

  async stop(): Promise<void> {
    if (this.#state.kind !== 'running') {
      return;
    }
    this.#state = { kind: 'stopping' };
    await this.#source.close();
  }

  async consumeOne(): Promise<void> {
    let proofId: string;
    try {
      proofId = await this.#source.take();
    } catch (error) {
      if (this.#state.kind === 'stopping') {
        return;
      }
      throw error;
    }
    if (this.#state.kind === 'running') {
      await this.#sink.deliver(proofId);
    }
  }
}
