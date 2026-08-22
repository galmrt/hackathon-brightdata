import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { BatchSpanProcessor, ConsoleSpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { trace } from "@opentelemetry/api";
import { config } from "./config.js";

const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: "watchtower-probe-runner",
});

const spanProcessor = config.signoz.endpoint
  ? new BatchSpanProcessor(
      // SigNoz cloud ingestion expects the access key on this header; confirm the
      // exact header name for our instance during the workshop (CLAUDE.md §4).
      new OTLPTraceExporter({
        url: `${config.signoz.endpoint.replace(/\/$/, "")}/v1/traces`,
        headers: config.signoz.apiKey ? { "signoz-ingestion-key": config.signoz.apiKey } : undefined,
      }),
    )
  : (() => {
      console.warn(
        "[otel] SIGNOZ_ENDPOINT not set — falling back to console span export. Set it in .env once the workshop confirms the ingestion endpoint.",
      );
      return new SimpleSpanProcessor(new ConsoleSpanExporter());
    })();

const provider = new NodeTracerProvider({ resource, spanProcessors: [spanProcessor] });

provider.register();

export const tracer = trace.getTracer("watchtower-probe-runner");

export async function shutdownTracing(): Promise<void> {
  await provider.shutdown();
}
