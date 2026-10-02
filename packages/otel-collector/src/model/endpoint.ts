export interface CollectorHttpInput {
  readonly kind: 'http';
  readonly host: string;
  readonly port: number;
  readonly tracesPath: string;
  readonly activationPath: string;
  readonly readinessPath: string;
  readonly readPath: string;
}

export interface CollectorEndpoint {
  readonly kind: 'http';
  readonly host: string;
  readonly port: number;
  readonly baseUrl: string;
  readonly tracesPath: string;
  readonly tracesUrl: string;
  readonly activationPath: string;
  readonly activationUrl: string;
  readonly readinessPath: string;
  readonly readinessUrl: string;
  readonly readPath: string;
  readonly readUrl: string;
}
