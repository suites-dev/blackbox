export class DriverFence {
  #phase = 'before-capture-arm';

  assertFixtureControlAllowed() {
    if (this.#phase === 'window-open') {
      throw new Error('fixture controls are forbidden between capture arm and receiver seal');
    }
  }

  async measure(operation) {
    if (this.#phase === 'window-open') {
      throw new Error('a measured operation is already active');
    }
    this.#phase = 'window-open';
    try {
      return await operation();
    } finally {
      this.#phase = 'after-receiver-seal';
    }
  }
}
