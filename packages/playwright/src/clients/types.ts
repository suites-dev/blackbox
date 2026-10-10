import type { SandboxContainer } from '@suites/blackbox-sandbox';

export interface ClientEndpoint {
  readonly url: string;
  readonly host: string;
  readonly port: number;
  readonly protocol: string;
}
export interface ClientSandbox extends Partial<
  Record<'clientServices', Readonly<Record<string, string>>>
> {
  readonly containers: ReadonlyMap<string, SandboxContainer>;
}
export interface ClientTarget {
  readonly participant: string;
  readonly containerPort: number;
}
export interface ClientDefinition<Client = unknown> {
  readonly target: ClientTarget;
  readonly env: readonly string[];
  create(
    endpoint: ClientEndpoint,
    environment: Readonly<Record<string, string | undefined>>,
  ): Promise<Client>;
  ready(client: Client): unknown;
  dispose(client: Client): unknown;
}
export type ClientRegistry = Readonly<Record<string, ClientDefinition>>;
export type RegisteredClients<Definitions extends ClientRegistry> = {
  readonly [Name in keyof Definitions]: Definitions[Name] extends ClientDefinition<infer Client>
    ? Client
    : never;
};
