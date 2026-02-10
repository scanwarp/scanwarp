# ScanWarp

**Your AI writes your code. ScanWarp keeps it running.**

A monitoring and observability platform designed for AI-generated code, built with TypeScript and a modern monorepo architecture.

## Features

- **CLI Tool**: Monitor and manage services from the command line
- **Webhook Server**: Receive and process monitoring events via Fastify
- **MCP Integration**: Model Context Protocol server for AI agent interactions
- **Real-time Monitoring**: Track service health and performance
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

```bash
# Build the CLI
cd packages/cli
pnpm build

# Run commands
./dist/index.js monitor <service-name>
./dist/index.js status
```

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

```
PORT=3000
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=scanwarp
POSTGRES_USER=scanwarp
POSTGRES_PASSWORD=scanwarp
```

## API Endpoints

- `GET /health` - Health check
- `POST /webhook` - Receive monitoring webhooks
- `GET /events` - Retrieve recent webhook events

## License

MIT
