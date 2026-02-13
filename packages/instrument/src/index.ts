import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Enable OTel diagnostic logging in debug mode
if (process.env["SCANWARP_DEBUG"] === "true") {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
}

const serverUrl =
  process.env["SCANWARP_SERVER"] ?? "http://localhost:3000";
const projectId = process.env["SCANWARP_PROJECT_ID"];

if (!projectId) {
  console.warn(
    "[@scanwarp/instrument] SCANWARP_PROJECT_ID is not set. Instrumentation will not start."
  );
} else {
  const serviceName = resolveServiceName();

  const resource = new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
    [SemanticResourceAttributes.SERVICE_VERSION]: resolveServiceVersion(),
    "scanwarp.project.id": projectId,
  });

  const traceExporter = new OTLPTraceExporter({
    url: `${serverUrl}/v1/traces`,
    headers: {
      "x-scanwarp-project-id": projectId,
    },
  });

  const metricExporter = new OTLPMetricExporter({
    url: `${serverUrl}/v1/metrics`,
    headers: {
      "x-scanwarp-project-id": projectId,
    },
  });

  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 30_000,
  });

  const sdk = new NodeSDK({
    resource,
    traceExporter,
    metricReader,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Enable useful instrumentations
        "@opentelemetry/instrumentation-http": { enabled: true },
        "@opentelemetry/instrumentation-express": { enabled: true },
        "@opentelemetry/instrumentation-fastify": { enabled: true },
        "@opentelemetry/instrumentation-pg": { enabled: true },
        "@opentelemetry/instrumentation-mysql": { enabled: true },
        "@opentelemetry/instrumentation-redis-4": { enabled: true },

        // Disable noisy / low-value instrumentations
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-dns": { enabled: false },
        "@opentelemetry/instrumentation-net": { enabled: false },
      }),
    ],
  });

  sdk.start();

  // Graceful shutdown — flush pending spans and metrics
  const shutdown = () => {
    sdk
      .shutdown()
      .then(() => process.exit(0))
      .catch((err) => {
        console.error("[@scanwarp/instrument] Shutdown error:", err);
        process.exit(1);
      });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  console.log(
    `[@scanwarp/instrument] Tracing started → ${serverUrl} (service: ${serviceName}, project: ${projectId})`
  );
}

/**
 * Resolve the service name from env var or nearest package.json.
 */
function resolveServiceName(): string {
  const fromEnv = process.env["SCANWARP_SERVICE_NAME"];
  if (fromEnv) return fromEnv;

  const pkg = readPackageJson();
  if (typeof pkg?.name === "string") return pkg.name;

  return "unknown-service";
}

/**
 * Resolve the service version from the nearest package.json.
 */
function resolveServiceVersion(): string {
  const pkg = readPackageJson();
  return (pkg?.version as string) ?? "0.0.0";
}

/**
 * Read the nearest package.json relative to cwd.
 */
function readPackageJson(): Record<string, unknown> | null {
  try {
    const raw = readFileSync(join(process.cwd(), "package.json"), "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}
