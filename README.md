# ScanWarp

**Your AI writes your code. ScanWarp keeps it running.**

Open-source monitoring for AI-built apps. When something breaks in production, ScanWarp diagnoses the issue and feeds the fix directly to your AI coding tool. No DevOps knowledge required.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## The Flywheel

```
       ┌─────────────────────────────┐
       │                             │
       ▼                             │
    Build ──→ Monitor ──→ Diagnose ──→ Fix
       │         │           │         │
    Cursor    ScanWarp     Claude    Cursor
    Claude    watches     explains   reads fix
    Code     everything   why it     via MCP
              24/7        broke      and applies
```

1. **Build** — You build your app with Cursor, Claude Code, or any AI coding tool
2. **Monitor** — ScanWarp watches your app: health checks, request traces, payment webhooks, CI pipelines, provider outages
3. **Diagnose** — Claude AI analyzes the issue in plain English, pinpoints the bottleneck, and generates a fix prompt
4. **Fix** — Your AI coding tool reads the diagnosis and fix prompt directly via MCP — no copy-pasting. ScanWarp verifies the fix landed.

The loop runs continuously. Every fix is monitored. Every new issue is diagnosed.

## Get Started

```bash
npx scanwarp dev       # full flywheel running locally while you build
npx scanwarp init      # same flywheel in production when you ship
```

ScanWarp auto-detects your framework (Next.js, Remix, SvelteKit, Astro, Vue, Nuxt), hosting (Vercel, Railway, Render), and services (Stripe, Supabase, GitHub). Setup takes under a minute.

## Build

Works with any AI coding tool that supports MCP:

- **Cursor** — auto-configured during `scanwarp init`
- **Claude Code** — auto-configured during `scanwarp init`
- **Any MCP client** — connect to `@scanwarp/mcp`

Auto-detects your framework and installs zero-config OpenTelemetry tracing for HTTP, PostgreSQL, MySQL, Redis, Express, and Fastify.

## Monitor

| Source | What ScanWarp captures |
|--------|----------------------|
| **Health checks** | HTTP monitoring every 60s with response time tracking |
| **Vercel** | Production errors via log drain |
| **Stripe** | Payment failures, expired checkouts, subscription cancellations |
| **GitHub** | Failed CI workflows, Dependabot alerts, code scanning alerts |
| **Supabase** | Database health, connection pool utilization |
| **OpenTelemetry** | Full request traces: HTTP, databases, Redis — zero config |
| **Provider status** | Vercel, Stripe, Supabase, GitHub, Cloudflare, Railway, AWS, Resend |

During development, `scanwarp dev` also runs:
- Route discovery and live request analysis
- N+1 query detection, slow query alerts, schema drift detection
- File watcher that re-checks routes when you save

## Diagnose

When ScanWarp detects an anomaly — a new error type, a traffic spike, a slow trace — it calls Claude AI with the full context: events, request traces, and provider status.

The diagnosis includes:
- **Root cause** in plain English — no jargon, no raw stack traces
- **Bottleneck identification** from OpenTelemetry traces — the exact operation that failed or is slow
- **Provider awareness** — if Vercel or Stripe is having an outage, ScanWarp says "this is a provider issue, not your code" and skips code fix suggestions
- **Fix prompt** designed for AI coding tools — specific files, specific changes, how to test

## Fix

Your AI coding tool connects to ScanWarp via MCP and can directly access:

| MCP Tool | What it provides |
|----------|-----------------|
| `get_app_status` | Overall health: monitors, incidents, providers |
| `get_incidents` | Open incidents with AI diagnosis |
| `get_fix_prompt` | The fix prompt, ready to execute |
| `get_trace_detail` | Full request waterfall with span-level detail |
| `get_recent_traces` | Latest OpenTelemetry traces |
| `get_incident_detail` | Complete incident: root cause, timeline, fix |
| `get_events` | Recent events with filtering |
| `resolve_incident` | Close the loop: mark incident as resolved |

Your AI tool sees what broke and knows how to fix it — without you leaving your editor.

For team awareness, ScanWarp also sends notifications to **Discord** and **Slack** with the full diagnosis, fix prompt, and a "Provider Issue" badge when the problem is upstream.

## Dashboard

Built-in web dashboard at your server URL:

- **Overview** — Monitor health, open incidents, recent errors at a glance
- **Monitors** — Health checks with status and response time history
- **Events** — Filterable stream from all sources
- **Incidents** — AI diagnosis with root cause, suggested fix, and fix prompt
- **Traces** — Request waterfall: color-coded spans, click-to-expand details, bottleneck highlighting

## Deploy

**Self-host with SQLite (zero dependencies):**

```bash
npx scanwarp server
npx scanwarp init --server http://localhost:3000
```

Data at `~/.scanwarp/scanwarp.db`. No Docker, no Postgres.

**One-click cloud:**

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template/scanwarp?referralCode=scanwarp)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/scanwarp/scanwarp)

**Docker + Postgres:**

```bash
docker compose up -d
npx scanwarp init --server http://localhost:3000
```

## Reference

**CLI:**

| Command | Description |
|---------|-------------|
| `scanwarp dev` | Run your app with the full monitoring flywheel locally |
| `scanwarp init` | Connect production app to your ScanWarp server |
| `scanwarp server` | Self-host the server with SQLite |
| `scanwarp status` | Check monitor health and active incidents |
| `scanwarp events` | View events (`--follow`, `--type`, `--source`) |

**Packages:**

| Package | What it does |
|---------|-------------|
| `packages/cli` | CLI: `dev`, `init`, `server`, `status`, `events` |
| `packages/core` | AI diagnoser (Claude), event correlator, shared types |
| `packages/instrument` | Zero-config OpenTelemetry auto-instrumentation |
| `packages/mcp` | MCP server for Cursor and Claude Code |
| `apps/server` | Fastify server: REST API, dashboard, monitoring engine |

**Key environment variables:**

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Enables AI diagnosis |
| `DATABASE_TYPE` | `sqlite` (default) or `postgres` |
| `PORT` | Server port (default `3000`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook verification |
| `GITHUB_WEBHOOK_SECRET` | GitHub webhook verification |
| `SUPABASE_PROJECT_REF` | Supabase project reference |
| `SCANWARP_SERVER` | Server URL for instrumentation |
| `SCANWARP_PROJECT_ID` | Project identifier for instrumentation |

## Community

- [Website](https://scanwarp.com)
- [Discord](https://discord.gg/K79UAMudM)

## License

MIT
