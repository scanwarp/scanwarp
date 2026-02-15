# ScanWarp

**Your AI writes your code. ScanWarp keeps it running.**

Open-source monitoring for AI-built apps. When something breaks, Claude AI diagnoses the issue and generates a fix prompt you can paste directly into Cursor or Claude Code.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Get Started

```bash
npx scanwarp dev       # monitor locally while you build
npx scanwarp init      # connect production monitoring
```

Auto-detects your framework (Next.js, Remix, SvelteKit, Astro, Vue, Nuxt), hosting (Vercel, Railway, Render), and services (Stripe, Supabase, GitHub). Works with Cursor and Claude Code out of the box via MCP.

## Deploy

```bash
npx scanwarp server                              # SQLite, zero deps
docker compose up -d                             # Docker + Postgres
```

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template/scanwarp?referralCode=scanwarp)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/scanwarp/scanwarp)

## How It Works

1. **Monitor** — Health checks, Vercel log drains, Stripe webhooks, GitHub CI, Supabase, OpenTelemetry traces, provider status pages
2. **Diagnose** — Claude AI explains what broke in plain English, identifies bottleneck spans, detects provider outages
3. **Fix** — Your AI coding tool reads the diagnosis via MCP and applies the fix. ScanWarp verifies it landed.

## Documentation

- [API Reference](docs/api.md)
- [Self-Hosting Guide](docs/self-hosting.md)
- [MCP Integration](docs/mcp.md)
- [Notifications](docs/notifications.md)

## Packages

| Package | Description |
|---------|-------------|
| `packages/cli` | CLI tool (`scanwarp dev`, `scanwarp init`) |
| `packages/core` | AI diagnoser, event correlator, shared types |
| `packages/instrument` | Zero-config OpenTelemetry auto-instrumentation |
| `packages/mcp` | MCP server for Cursor and Claude Code |
| `apps/server` | Fastify server: API, dashboard, monitoring engine |

## Community

- [Website](https://scanwarp.com)
- [Discord](https://discord.gg/K79UAMudM)

## License

MIT
