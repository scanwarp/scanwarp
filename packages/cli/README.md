# ScanWarp CLI

**Your AI writes your code. ScanWarp keeps it running.**

Production monitoring built for developers who ship fast with AI tools like Cursor and Claude Code. Auto-diagnoses issues and suggests fixes directly to your AI coding assistant.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/scanwarp.svg)](https://www.npmjs.com/package/scanwarp)

## Quick Start

```bash
# Monitor locally while you build
npx scanwarp dev

# Connect production app to ScanWarp
npx scanwarp init
```

## What You Get

After running `scanwarp init`, you'll have:

### 📊 **Web Dashboard**
Visit your server URL (e.g., `http://localhost:3000` or your hosted URL) to access:

- **Overview** - System health at a glance
- **Monitors** - Uptime and response time tracking
- **Events** - Real-time feed from your app, Stripe, GitHub, Vercel
- **Incidents** - Auto-detected issues with AI diagnosis
- **Traces** - OpenTelemetry request waterfalls with bottleneck highlighting

### 🤖 **AI Diagnosis**
When something breaks, Claude AI analyzes the full context and tells you:
- Root cause in plain English
- Exact file and line that needs fixing
- Ready-to-execute fix prompt for your AI tool

### 🔌 **MCP Integration**
Your AI coding tool (Cursor, Claude Code) connects via MCP to:
- See what's broken
- Get fix suggestions
- Read trace details
- Resolve incidents

All without leaving your editor.

### 📡 **Request Tracing**
Zero-config OpenTelemetry instrumentation captures:
- HTTP requests
- Database queries
- External API calls
- Performance bottlenecks

Automatically installed with `scanwarp init` (or skip with `--skip-instrumentation`).

### 🔔 **Notifications**
Get alerts via:
- Discord webhooks
- Slack webhooks
- Email (coming soon)

## Commands

| Command | Description |
|---------|-------------|
| `scanwarp dev` | Run full monitoring flywheel locally while you build |
| `scanwarp init` | Connect production app to ScanWarp server |
| `scanwarp server` | Self-host the server with SQLite (zero deps) |
| `scanwarp status` | Check monitor health and active incidents |
| `scanwarp events` | Stream events (`--follow`, `--type`, `--source`) |

## What Gets Monitored

| Source | What it captures |
|--------|-----------------|
| **Health checks** | HTTP monitoring every 60s, response time |
| **Vercel** | Production errors via log drain |
| **Stripe** | Payment failures, subscription issues |
| **GitHub** | Failed CI, Dependabot alerts |
| **Supabase** | Database health, connection pool |
| **OpenTelemetry** | Request traces (HTTP, DB, Redis) |
| **Provider status** | Vercel, Stripe, GitHub, Cloudflare, Railway, AWS outages |

During `scanwarp dev`, also detects N+1 queries, slow queries, and schema drift.

## Deploy Your ScanWarp Server

You need a ScanWarp server to send data to. Choose one:

**Option 1: One-Click Deploy (60 seconds)**

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template/scanwarp?referralCode=scanwarp)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/scanwarp/scanwarp)

Then run: `npx scanwarp init --server https://your-server-url.up.railway.app`

**Option 2: Self-Host**

```bash
# SQLite, zero dependencies
npx scanwarp server

# Or with Docker + Postgres
docker compose up -d
```

Then run: `npx scanwarp init --server http://localhost:3000`

## Connect Your AI Tool

### Cursor

1. Open Cursor Settings → Features → MCP
2. Add ScanWarp MCP server:
```json
{
  "mcpServers": {
    "scanwarp": {
      "command": "npx",
      "args": ["-y", "scanwarp", "mcp", "--server", "YOUR_SERVER_URL"]
    }
  }
}
```
3. Restart Cursor
4. Ask: "What's broken in production?" or "Show me the slowest requests"

### Claude Code

Run `scanwarp init` and select "Yes" when asked about MCP configuration. It will auto-configure for you.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SCANWARP_SERVER_URL` | Your ScanWarp server URL |
| `SCANWARP_PROJECT_ID` | Project identifier (auto-saved after init) |
| `ANTHROPIC_API_KEY` | Required for AI diagnosis |

## Example Workflow

```bash
# 1. Deploy ScanWarp server
# (Use Railway/Render button above)

# 2. Initialize monitoring in your app
cd my-nextjs-app
npx scanwarp init --server https://my-scanwarp.up.railway.app

# 3. Deploy your app
git push

# 4. Check the dashboard
# Visit https://my-scanwarp.up.railway.app

# 5. Ask your AI tool (via MCP)
# "What's broken in production?"
# "Show me the slowest API endpoints"
# "Get the fix prompt for incident #123"
```

## Learn More

- **Docs**: [GitHub Repository](https://github.com/scanwarp/scanwarp)
- **Website**: [scanwarp.com](https://scanwarp.com)
- **Discord**: [Join the community](https://discord.gg/K79UAMudM)

## License

MIT
