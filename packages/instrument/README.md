# @scanwarp/instrument

Zero-config OpenTelemetry auto-instrumentation for Node.js apps monitored by ScanWarp.

When loaded, it automatically traces HTTP requests, database queries (Postgres, MySQL, Redis), and outbound fetch/HTTP calls — with zero code changes.

## Quickstart

```bash
npm install @scanwarp/instrument
```

### Option 1: `--require` flag (any Node.js app)

```bash
SCANWARP_PROJECT_ID=your-project-id \
  node --require @scanwarp/instrument ./dist/server.js
```

### Option 2: Next.js `instrumentation.ts` hook

Create `instrumentation.ts` in your project root:

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("@scanwarp/instrument");
  }
}
```

### Option 3: Import at the top of your entrypoint

```ts
import "@scanwarp/instrument";
// ... rest of your app
```

> The import **must** be the first import in your entrypoint so OpenTelemetry can patch modules before they are loaded.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SCANWARP_PROJECT_ID` | Yes | — | Your ScanWarp project ID |
| `SCANWARP_SERVER` | No | `http://localhost:3000` | ScanWarp server URL |
| `SCANWARP_SERVICE_NAME` | No | Auto-detected from `package.json` `name` | Service name for traces |
| `SCANWARP_DEBUG` | No | `false` | Set to `true` to enable OTel diagnostic logging |

## What gets instrumented

Automatically enabled:

- **HTTP** — incoming and outgoing `http`/`https` requests
- **Express** — route-level spans
- **Fastify** — route-level spans
- **PostgreSQL** (`pg`) — query spans with statement text
- **MySQL** — query spans
- **Redis** (`ioredis` / `redis@4`) — command spans
- **Fetch / Undici** — outbound `fetch()` and `undici` requests

Explicitly disabled (noisy, low value):

- `fs` — filesystem operations
- `dns` — DNS lookups
- `net` — raw TCP socket operations

## How it works

`@scanwarp/instrument` initializes the OpenTelemetry Node SDK at import time. It:

1. Creates an OTLP HTTP trace exporter pointed at your ScanWarp server (`/v1/traces`)
2. Creates an OTLP HTTP metric exporter pointed at your ScanWarp server (`/v1/metrics`)
3. Registers auto-instrumentations for supported libraries
4. Attaches `scanwarp.project.id` as a resource attribute on all telemetry
5. Flushes pending data on `SIGTERM`/`SIGINT` for graceful shutdown

Metrics are exported every 30 seconds. Traces are exported in batches by the SDK's default `BatchSpanProcessor`.
