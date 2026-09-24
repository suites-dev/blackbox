export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type ClientResult =
  | { readonly kind: 'json'; readonly value: JsonValue }
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'empty' };

export interface ClientEndpoint {
  readonly protocol: string;
  readonly host: string;
  readonly port: number;
  readonly url: string;
}

interface ClientTargetFields {
  readonly participantId: string;
  readonly service: string;
  readonly environment: Readonly<Record<string, string>>;
}

export type ClientTarget =
  | (ClientTargetFields & {
      readonly kind: 'entrypoint';
      readonly endpoint: ClientEndpoint;
    })
  | (ClientTargetFields & {
      readonly kind: 'participant';
      readonly endpoint: ClientEndpoint;
    });

export interface ClientExecutionInput {
  readonly args: readonly string[];
  readonly target: ClientTarget;
  readonly telemetry: ClientTelemetry;
}

export type ClientTelemetry =
  | { readonly kind: 'disabled' }
  | {
      readonly kind: 'enabled';
      readonly sessionId: string;
      readonly executionId: string;
      readonly activityId: string;
    };

export type ClientCallback = (
  input: ClientExecutionInput,
) => ClientResult | Promise<ClientResult>;

interface ClientDefinitionFields {
  readonly name: string;
  readonly run: ClientCallback;
}

export type ClientDefinition =
  | (ClientDefinitionFields & { readonly kind: 'entrypoint' })
  | (ClientDefinitionFields & { readonly kind: 'utility' });
