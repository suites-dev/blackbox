export class DriverProtocolError extends Error {
  readonly operation: 'decode-request' | 'decode-response' | 'validate-preparation';

  constructor(input: {
    readonly operation: DriverProtocolError['operation'];
    readonly message: string;
  }) {
    super(input.message);
    this.name = 'DriverProtocolError';
    this.operation = input.operation;
  }
}
