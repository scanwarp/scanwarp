# ScanWarp

**Your AI writes your code. ScanWarp keeps it running.**

Production monitoring built for developers who ship fast. Auto-diagnoses issues with Claude AI and tells you exactly how to fix them.

## Quick Start

```bash
npx scanwarp init
```

```
✓ Detected Next.js on Vercel
✓ Created monitor for https://yourapp.vercel.app
✓ Configured Vercel log drain
✓ Set up MCP for Cursor
🎉 Done! Monitoring in 30 seconds.
```

## What It Does

- **Monitors your app** — Health checks every 60s, ingests logs from Vercel/Stripe/GitHub
- **Detects issues** — Smart anomaly detection flags new errors and traffic spikes
- **Diagnoses with AI** — Claude explains what broke in plain English (no jargon)
- **Gives you fix prompts** — Ready-to-paste prompts for Cursor/Claude Code to fix the issue
- **Notifies your team** — Discord/Slack alerts with full diagnosis and suggested fixes

## Works With

**Integrations:** Vercel • Stripe • Supabase • GitHub • Cloudflare

**AI Assistants:** Cursor • Claude Code (via MCP)

## Self-Host

```bash
docker compose up -d
npx scanwarp init --server http://localhost:3000
```

[Full self-hosting guide →](docs/self-hosting.md)

## How is this different from Datadog/Sentry?

Traditional monitoring tools show you *what* broke. ScanWarp tells you *why* and *how to fix it*. It's built for developers who use AI coding assistants — the diagnosis is written in plain English and includes ready-to-paste prompts for your AI tool. No infrastructure expertise required.

## Documentation

- [API Reference](docs/api.md) — REST endpoints for monitoring, incidents, and events
- [MCP Integration](docs/mcp.md) — Connect Cursor/Claude Code directly to your monitoring data
- [Notifications](docs/notifications.md) — Discord/Slack alerts with rate limiting
- [Self-Hosting](docs/self-hosting.md) — Environment variables and deployment options

## Community

- [Website](https://scanwarp.com)
- [Discord](https://discord.gg/K79UAMudM)
- [Documentation](https://docs.scanwarp.com) (coming soon)

## License

MIT

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
