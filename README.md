# ScanWarp

**Your AI writes your code. ScanWarp keeps it running.**

Open-source monitoring for AI-built apps. Like Datadog, but your AI coding tool can read the diagnosis and fix the issue directly — no DevOps knowledge required.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## The Flywheel

```
       ┌─────────────────────────────┐
       │                             │
       ▼                             │
    Build ──→ Monitor ──→ Diagnose ──→ Fix
```

1. **Build** — You ship with Cursor, Claude Code, or any AI coding tool
2. **Monitor** — ScanWarp watches health, traces, payments, CI, and provider outages
3. **Diagnose** — Claude AI explains what broke and generates a fix prompt
4. **Fix** — Your AI tool reads the fix via MCP and applies it. ScanWarp verifies it landed.

The loop runs continuously. Every fix is monitored. Every new issue is diagnosed.

## Get Started

```bash
npx scanwarp dev       # full flywheel locally while you build
npx scanwarp init      # same flywheel in production
```

Auto-detects your framework (Next.js, Remix, SvelteKit, Astro, Vue, Nuxt), hosting (Vercel, Railway, Render), and services (Stripe, Supabase, GitHub). Works with Cursor and Claude Code out of the box via MCP.

## Deploy

Get a hosted ScanWarp server, then run `npx scanwarp init --server <url>` to connect your app.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template/scanwarp?referralCode=scanwarp)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/scanwarp/scanwarp)

**Or self-host:**

```bash
npx scanwarp server                              # SQLite, zero deps
docker compose up -d                             # Docker + Postgres
```

## How It Works

### Monitor

| Source | What it captures |
|--------|-----------------|
| **Health checks** | HTTP monitoring every 60s, response time tracking |
| **Vercel** | Production errors via log drain |
| **Stripe** | Payment failures, expired checkouts, subscription cancellations |
| **GitHub** | Failed CI workflows, Dependabot alerts, code scanning alerts |
| **Supabase** | Database health, connection pool utilization |
| **OpenTelemetry** | Request traces — HTTP, databases, Redis — zero config |
| **Provider status** | Vercel, Stripe, Supabase, GitHub, Cloudflare, Railway, AWS, Resend |

During development, `scanwarp dev` also detects N+1 queries, slow queries, schema drift, and re-analyzes routes on file save.

### Diagnose

When ScanWarp detects an anomaly — a new error type, a traffic spike, a slow trace — Claude AI analyzes the full context and produces:

- **Root cause** in plain English — no jargon, no raw stack traces
- **Bottleneck ID** from OpenTelemetry traces — the exact span that failed or is slow
- **Provider awareness** — "Vercel is down, this isn't your code"
- **Fix prompt** for AI coding tools — specific files, specific changes, how to test

### Fix

Your AI coding tool connects to ScanWarp via MCP:

| MCP Tool | What it provides |
|----------|-----------------|
| `get_app_status` | Overall health: monitors, incidents, providers |
| `get_incidents` | Open incidents with AI diagnosis |
| `get_fix_prompt` | Ready-to-execute fix prompt |
| `get_trace_detail` | Full request waterfall with span-level detail |
| `get_recent_traces` | Latest OpenTelemetry traces |
| `get_incident_detail` | Root cause, timeline, and fix |
| `get_events` | Recent events with filtering |
| `resolve_incident` | Mark incident resolved — close the loop |

Your AI tool sees what broke and how to fix it — without you leaving your editor. Discord and Slack notifications keep the team in the loop.

## Dashboard

Built-in web UI: Overview, Monitors, Events, Incidents (with AI diagnosis), and Traces (with waterfall visualization and bottleneck highlighting).

## Reference

**CLI:**

| Command | Description |
|---------|-------------|
| `scanwarp dev` | Run the full monitoring flywheel locally |
| `scanwarp init` | Connect a production app to your ScanWarp server |
| `scanwarp server` | Self-host the server with SQLite |
| `scanwarp status` | Check monitor health and active incidents |
| `scanwarp events` | Stream events (`--follow`, `--type`, `--source`) |

**Packages:**

| Package | Description |
|---------|-------------|
| `packages/cli` | CLI tool |
| `packages/core` | AI diagnoser, event correlator, shared types |
| `packages/instrument` | Zero-config OpenTelemetry auto-instrumentation |
| `packages/mcp` | MCP server for Cursor and Claude Code |
| `apps/server` | Fastify server: API, dashboard, monitoring engine |

**Environment variables:**

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Enables AI diagnosis |
| `DATABASE_TYPE` | `sqlite` (default) or `postgres` |
| `PORT` | Server port (default `3000`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook verification |
| `GITHUB_WEBHOOK_SECRET` | GitHub webhook verification |
| `SUPABASE_PROJECT_REF` | Supabase project reference |
| `SCANWARP_SERVER` | Server URL for instrumentation |
| `SCANWARP_PROJECT_ID` | Project identifier |

## Community

- [Website](https://scanwarp.com)
- [Discord](https://discord.gg/K79UAMudM)

## License

MIT
