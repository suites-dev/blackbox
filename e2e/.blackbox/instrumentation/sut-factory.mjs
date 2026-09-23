import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { AwsInstrumentation } from '@opentelemetry/instrumentation-aws-sdk';
import { Resource } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';

const FIXTURE_CONTROL_MARKER_HEADER = 'x-blackbox-fixture-control';

export default async function activate(context) {
	const endpoint = context.observation.otlpEndpoint.replace(/\/+$/u, '');
	const configuredInstrumentations = {
		'@opentelemetry/instrumentation-http': {
			headersToSpanAttributes: {
				server: { requestHeaders: [FIXTURE_CONTROL_MARKER_HEADER] },
			},
		},
		'@opentelemetry/instrumentation-aws-sdk': { enabled: false },
	};
	const exporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` });
	const spanProcessor = new BatchSpanProcessor(exporter, { scheduledDelayMillis: 200 });
	const sdk = new NodeSDK({
		spanProcessors: [spanProcessor],
		resource: new Resource({
			...context.observation.resourceAttributes,
			...context.observation.correlationAttributes,
		}),
		// This local SUT gets its exact identity from the execution plan. Cloud
		// metadata probes can delay export while resolving unrelated resources.
		autoDetectResources: false,
		instrumentations: [
			...getNodeAutoInstrumentations(configuredInstrumentations),
			new AwsInstrumentation(),
		],
	});
	sdk.start();

	let stopped = false;
	return {
		flush: async () => {
			if (!stopped) await spanProcessor.forceFlush();
		},
		shutdown: async () => {
		if (stopped) return;
		stopped = true;
		await sdk.shutdown();
		},
	};
}
