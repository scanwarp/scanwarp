# ScanWarp

**Your AI writes your code. ScanWarp keeps it running.**

A monitoring and observability platform designed for AI-generated code, built with TypeScript and a modern monorepo architecture.

## Features

- **CLI Tool**: Monitor and manage services from the command line
- **Webhook Server**: Receive and process monitoring events via Fastify
- **MCP Integration**: Model Context Protocol server for AI agent interactions
- **Real-time Monitoring**: Track service health, latency, and uptime every 60 seconds
- **AI-Powered Diagnosis**: Automatically diagnose production issues with Claude AI
- **Anomaly Detection**: Smart detection of new errors and traffic spikes
- **Vercel Integration**: Built-in log drain support for Vercel deployments
- **PostgreSQL Database**: Reliable data storage with raw SQL queries

## Architecture

This is a pnpm monorepo with the following structure:

```
scanwarp/
├── apps/
│   └── server/          # Fastify backend with webhook handling
├── packages/
│   ├── cli/             # Command-line interface tool
│   ├── core/            # Shared types and logic
│   └── mcp/             # MCP server implementation
└── docker-compose.yml   # Server + PostgreSQL setup
```

## Quick Start

### Prerequisites

- Node.js >= 18
- pnpm >= 8
- Docker & Docker Compose (for server deployment)

### Installation

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run in development mode
pnpm dev
```

### Running the Server

```bash
# Using Docker Compose
docker-compose up -d

# Or run locally
cd apps/server
pnpm dev
```

The server will be available at `http://localhost:3000`

### Using the CLI

The fastest way to get started:

```bash
# Initialize monitoring (30 seconds from install to monitoring!)
npx scanwarp init

# Or using the built CLI
cd packages/cli
pnpm build
node dist/index.js init
```

The `init` command will:
1. Auto-detect your project (framework, hosting, services)
2. Prompt for your production URL
3. Set up monitoring on the ScanWarp server
4. Configure Vercel log drains (if detected)
5. Show Stripe/GitHub webhook setup instructions
6. Auto-configure MCP for Cursor/Claude Desktop
7. Set up Discord/Slack notifications (optional)

**Other commands:**
```bash
# Check monitoring status
scanwarp status
scanwarp status --server https://api.scanwarp.com

# View recent events (logs)
scanwarp logs
scanwarp logs --follow                      # Stream live events
scanwarp logs --type error                  # Filter by type
scanwarp logs --source vercel               # Filter by source
scanwarp logs --limit 100                   # Show more events

# View open incidents
scanwarp incidents

# Options available for all commands
--server <url>                              # Specify server URL
```

**Configuration:**
The CLI stores your server URL and project ID in `~/.scanwarp/config.json` after running `init`. This means you don't need to specify `--server` on every command.

## Development

```bash
# Run linting
pnpm lint

# Type checking
pnpm typecheck

# Clean build artifacts
pnpm clean
```

## Environment Variables

Copy `apps/server/.env.example` to `apps/server/.env` and configure:

```bash
PORT=3000
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=scanwarp
POSTGRES_USER=scanwarp
POSTGRES_PASSWORD=scanwarp

# AI Diagnosis (optional - get your key from https://console.anthropic.com/)
ANTHROPIC_API_KEY=your_api_key_here
```

## API Endpoints

### Monitoring
- `POST /monitors` - Create a new URL monitor
- `GET /monitors` - List all monitors
- `GET /monitors/:id` - Get monitor details

### Events
- `GET /events` - Query events with filters (monitor_id, project_id, type, limit)

### Incidents (AI Diagnosis)
- `GET /incidents` - List incidents with filters (project_id, status, limit)
- `GET /incidents/:id` - Get incident details with full AI diagnosis
- `POST /incidents/:id/resolve` - Mark incident as resolved

### Webhooks & Integrations
- `POST /ingest/vercel` - Vercel log drain webhook (auto-detects errors)
- `POST /ingest/stripe` - Stripe webhook (payment failures, subscription events)
- `POST /ingest/github` - GitHub webhook (workflow failures, security alerts)
- `POST /webhook` - Generic webhook endpoint
- `GET /health` - Health check

## How It Works

### 1. Monitoring Engine
ScanWarp continuously monitors your services:
- Checks each URL every 60 seconds
- Records response time, status codes, and errors
- Detects when services go down or slow down (3x avg latency)
- Automatically creates "down", "up", and "slow" events

### 2. Provider Integrations
Automatically ingests events from your infrastructure:
- **Vercel**: Error logs from deployments
- **Stripe**: Payment failures, subscription cancellations
- **GitHub**: Failed workflows, security alerts
- **Supabase**: Database health, connection pool issues (optional polling)
- **Provider Status**: Tracks Vercel, Stripe, GitHub, Cloudflare, Supabase outages

### 3. Correlation Engine
Intelligently groups related events:
- Same endpoint failing multiple times → single incident
- Stripe payment failure + checkout API error → correlated
- Multiple monitors down + provider outage → provider issue (not your code)
- Prevents alert fatigue by grouping related problems

### 4. Anomaly Detection
Smart detection flags issues that need attention:
- **New error types**: First time seeing this error
- **Error rate spikes**: 3x more errors than baseline
- Everything else is logged quietly

### 5. AI Diagnosis
When an anomaly is detected, Claude automatically:
1. Analyzes the error and recent history
2. Checks if it's a provider outage (not your fault)
3. Explains what broke in plain English (no jargon)
4. Suggests how to fix it
5. Generates a ready-to-paste prompt for your AI coding assistant

The diagnosis is written for developers who built their app with AI tools - no infrastructure expertise required.

## Example Diagnosis Output

```json
{
  "root_cause": "Your API is timing out because the database connection pool is exhausted. Too many requests are waiting for available connections.",
  "severity": "critical",
  "suggested_fix": "Increase your database connection pool size and add connection timeouts to prevent requests from hanging indefinitely.",
  "fix_prompt": "Update the database configuration in apps/server/src/index.ts:\n\n1. Find the postgres connection setup\n2. Add these options: max: 20, idle_timeout: 30, connect_timeout: 10\n3. Also add a request timeout middleware in Fastify to kill requests after 30 seconds\n4. Test by making several concurrent requests to your API"
}
```

## Testing

### End-to-End Tests

Run the comprehensive E2E test suite:

```bash
# From project root
pnpm test:e2e
```

This will:
1. ✅ Check prerequisites (Docker, ports)
2. 🐳 Start PostgreSQL and run migrations
3. 🚀 Start ScanWarp server
4. 🧪 Start test app with intentional bugs
5. 📊 Register monitors and wait for checks
6. 🔍 Verify event detection
7. 🤖 Verify AI diagnosis (if ANTHROPIC_API_KEY set)
8. 🔌 Verify MCP server
9. 📢 Verify notifications
10. 🧹 Clean up all resources

Expected output:
```
╔═══════════════════════════════════════════╗
║   ScanWarp End-to-End Test Suite         ║
╚═══════════════════════════════════════════╝

=== Prerequisites Check ===
✓ Docker is running
✓ Port 3000 is available
✓ Port 4000 is available
✓ Port 5432 is available

...

=== Test Summary ===
18/18 tests passed (100%)
🎉 All tests passed!
```

See [scripts/README.md](scripts/README.md) for detailed test documentation.

## MCP Integration

ScanWarp includes an MCP (Model Context Protocol) server that lets Cursor and Claude Code directly access your monitoring data.

### Setup

**Cursor** - Add to `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "scanwarp": {
      "command": "npx",
      "args": ["@scanwarp/mcp", "--server", "http://localhost:3000", "--project", "your-project-id"]
    }
  }
}
```

**Claude Desktop** - Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "scanwarp": {
      "command": "npx",
      "args": ["@scanwarp/mcp", "--server", "http://localhost:3000", "--project", "your-project-id"]
    }
  }
}
```

### Available Tools

Once configured, your AI assistant can:

- `get_app_status` - Check overall health
- `get_incidents` - List active incidents
- `get_incident_detail` - Get full diagnosis with fix prompts
- `get_fix_prompt` - Get ready-to-use fix prompt
- `get_events` - Query recent events
- `resolve_incident` - Mark incidents as resolved

**Example workflow:**
```
You: "What's wrong with my app?"
AI: [Calls get_app_status] "You have a critical incident. Your checkout
     API is returning 500 errors due to a null pointer exception..."
     [Calls get_fix_prompt] "Here's what to fix..."
```

See [packages/mcp/README.md](packages/mcp/README.md) for full documentation.

## Notifications

ScanWarp can send incident notifications to Discord or Slack.

### Setup Channels

```bash
# Create a Discord channel
curl -X POST http://localhost:3000/channels \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "your-project-id",
    "type": "discord",
    "webhook_url": "https://discord.com/api/webhooks/..."
  }'

# Create a Slack channel
curl -X POST http://localhost:3000/channels \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "your-project-id",
    "type": "slack",
    "webhook_url": "https://hooks.slack.com/services/..."
  }'

# Test notification
curl -X POST http://localhost:3000/channels/{channel-id}/test
```

### Notification Format

**Discord** - Rich embeds with:
- Red/orange/blue sidebar for severity
- Root cause, suggested fix, and impact
- Correlated events
- Fix prompt in footer

**Slack** - Formatted blocks with:
- Header with severity emoji
- Diagnosis and fix suggestions
- Code block with fix prompt
- Timestamp

### Rate Limiting

To prevent notification fatigue:
- Maximum 1 notification per incident per channel
- Maximum 10 notifications per hour per channel
- Critical incidents sent immediately
- Resolution notifications sent automatically

## Contributing

We welcome contributions! Please see our contributing guidelines.

## License

MIT
