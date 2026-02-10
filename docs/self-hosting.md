# Self-Hosting Guide

Run ScanWarp on your own infrastructure.

## Quick Start

```bash
# Clone the repo
git clone https://github.com/scanwarp/scanwarp.git
cd scanwarp

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Start with Docker Compose
docker compose up -d

# Initialize your first project
npx scanwarp init --server http://localhost:3000
```

Server runs on `http://localhost:3000`

---

## Docker Compose

The included `docker-compose.yml` starts:

1. **PostgreSQL** on port 5432
2. **ScanWarp Server** on port 3000

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: scanwarp
      POSTGRES_USER: scanwarp
      POSTGRES_PASSWORD: scanwarp
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  server:
    build: .
    ports:
      - "3000:3000"
    environment:
      PORT: 3000
      POSTGRES_HOST: postgres
      POSTGRES_PORT: 5432
      POSTGRES_DB: scanwarp
      POSTGRES_USER: scanwarp
      POSTGRES_PASSWORD: scanwarp
    depends_on:
      - postgres
```

### Customize

Edit `docker-compose.yml` or create `.env`:

```bash
# Database
POSTGRES_DB=scanwarp
POSTGRES_USER=scanwarp
POSTGRES_PASSWORD=your-secure-password

# Server
PORT=3000

# AI Diagnosis (optional)
ANTHROPIC_API_KEY=sk-ant-...

# Vercel Log Drain (optional)
# No secret needed - anyone can POST logs
```

Then:

```bash
docker compose up -d
```

---

## Environment Variables

### Required

**Database Connection:**
```bash
POSTGRES_HOST=localhost           # Database host
POSTGRES_PORT=5432                # Database port
POSTGRES_DB=scanwarp              # Database name
POSTGRES_USER=scanwarp            # Database user
POSTGRES_PASSWORD=scanwarp        # Database password
```

**Server:**
```bash
PORT=3000                         # Server port
```

### Optional

**AI Diagnosis:**
```bash
ANTHROPIC_API_KEY=sk-ant-...      # Get from console.anthropic.com
                                  # Without this, no AI diagnosis
```

**Provider Integrations:**

```bash
# Stripe webhook signature verification
STRIPE_WEBHOOK_SECRET=whsec_...   # From Stripe Dashboard

# GitHub webhook signature verification
GITHUB_WEBHOOK_SECRET=your-secret # Set in GitHub webhook settings

# Supabase health polling
SUPABASE_PROJECT_REF=abc123       # Your Supabase project ref
SUPABASE_SERVICE_KEY=eyJ...       # Service role key from Supabase
```

All provider integrations are optional. If not configured, those features simply don't start.

---

## Production Deployment

### Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Create new project
railway init

# Add PostgreSQL
railway add

# Deploy
railway up

# Set environment variables
railway variables set ANTHROPIC_API_KEY=sk-ant-...
railway variables set POSTGRES_HOST=${{ POSTGRES_HOST }}
```

Railway automatically provisions Postgres and sets connection variables.

### Fly.io

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Launch app
fly launch

# Create Postgres
fly postgres create

# Attach to app
fly postgres attach

# Set secrets
fly secrets set ANTHROPIC_API_KEY=sk-ant-...

# Deploy
fly deploy
```

### Render

1. Create new Web Service
2. Connect your GitHub repo
3. Build command: `pnpm install && pnpm build`
4. Start command: `cd apps/server && node dist/index.js`
5. Add PostgreSQL database
6. Set environment variables in dashboard
7. Deploy

### Vercel + Supabase

**Note:** Vercel is serverless, so the monitoring engine won't run continuously. Use Railway/Fly/Render for full functionality.

If you still want to deploy just the API endpoints:

1. Create `api/` directory with Vercel serverless functions
2. Connect Supabase for Postgres
3. Deploy to Vercel

(This setup only works for webhooks, not active monitoring)

---

## Database Migrations

On first run, the server automatically creates tables. Manual migration:

```bash
# Connect to your database
psql -h localhost -U scanwarp -d scanwarp

# Run the schema
\i apps/server/src/db/schema.sql
```

Or with Docker:

```bash
docker exec -i scanwarp-postgres-1 psql -U scanwarp -d scanwarp < apps/server/src/db/schema.sql
```

### Schema

See [apps/server/src/db/schema.sql](../apps/server/src/db/schema.sql) for complete schema.

Tables:
- `projects` — Your applications
- `monitors` — URL health checks
- `events` — All events (errors, downtime, etc)
- `incidents` — AI-diagnosed issues
- `notification_channels` — Discord/Slack webhooks
- `notification_log` — Rate limiting
- `provider_status` — External service health
- `event_stats` — Anomaly detection baselines

---

## Monitoring the Monitor

### Health Check

```bash
curl http://localhost:3000/health
```

Returns:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Logs

```bash
# Docker Compose logs
docker compose logs -f server

# Check database connection
docker compose logs postgres
```

### Metrics

Currently no built-in metrics. Coming soon:

- Prometheus endpoint
- Grafana dashboard
- OpenTelemetry tracing

---

## Security

### API Authentication

**Coming soon.** For now, secure your deployment with:

1. **Firewall rules** — Only allow trusted IPs
2. **VPN** — Put behind Tailscale/WireGuard
3. **Reverse proxy** — Use nginx with basic auth

### Webhook Signature Verification

**Stripe:**
```bash
STRIPE_WEBHOOK_SECRET=whsec_...
```

**GitHub:**
```bash
GITHUB_WEBHOOK_SECRET=your-secret
```

Without these, webhooks are accepted without verification (not recommended for production).

### Database Security

- Use strong passwords
- Enable SSL for Postgres connections
- Restrict Postgres port to internal network
- Regular backups

### Secrets Management

Use environment variables, not hardcoded secrets:

```bash
# Good
ANTHROPIC_API_KEY=${{ secrets.ANTHROPIC_API_KEY }}

# Bad
ANTHROPIC_API_KEY=sk-ant-api-key-here
```

For production, use:
- Railway secrets
- Fly.io secrets
- Render environment variables
- Docker secrets
- AWS Secrets Manager / GCP Secret Manager

---

## Backups

### Database Backup

```bash
# Dump database
docker exec scanwarp-postgres-1 pg_dump -U scanwarp scanwarp > backup.sql

# Restore
docker exec -i scanwarp-postgres-1 psql -U scanwarp scanwarp < backup.sql
```

### Automated Backups

Set up cron job:

```bash
# Daily backup at 2am
0 2 * * * docker exec scanwarp-postgres-1 pg_dump -U scanwarp scanwarp > /backups/scanwarp-$(date +\%Y\%m\%d).sql
```

Or use managed database backups:
- Railway automatic backups
- Render Postgres backups
- Supabase automatic backups

---

## Scaling

### Horizontal Scaling

**Current limitation:** MonitorRunner runs in-process and will duplicate if you run multiple server instances.

**Coming soon:** Redis-based job queue for distributed monitoring.

For now, run single instance. The server can handle:
- 1000s of monitors
- 10,000s of events per day
- Hundreds of webhooks per second

### Vertical Scaling

Increase resources for high load:

```yaml
# docker-compose.yml
services:
  server:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
```

### Database Scaling

For large deployments:

1. **Connection pooling** — Already using postgres.js with pooling
2. **Read replicas** — Point monitoring queries to replica
3. **Partitioning** — Partition events table by date
4. **Archiving** — Archive old events to cold storage

---

## Troubleshooting

### Server won't start

1. **Check database connection:**
   ```bash
   docker compose logs postgres
   ```

2. **Verify environment variables:**
   ```bash
   docker compose config
   ```

3. **Check port conflicts:**
   ```bash
   lsof -i :3000
   lsof -i :5432
   ```

### Monitors not running

1. **Check MonitorRunner started:**
   Look for "MonitorRunner started" in logs

2. **Verify monitors exist:**
   ```bash
   curl http://localhost:3000/monitors?project_id=your-id
   ```

3. **Check health checks:**
   Wait 60 seconds, then query events

### AI diagnosis not working

1. **Check ANTHROPIC_API_KEY is set:**
   ```bash
   echo $ANTHROPIC_API_KEY
   ```

2. **Verify API key is valid:**
   ```bash
   curl https://api.anthropic.com/v1/messages \
     -H "x-api-key: $ANTHROPIC_API_KEY" \
     -H "anthropic-version: 2023-06-01" \
     -H "content-type: application/json" \
     -d '{"model":"claude-3-5-sonnet-20241022","max_tokens":1024,"messages":[{"role":"user","content":"test"}]}'
   ```

3. **Check server logs for errors**

### High memory usage

1. **Events table growing too large:**
   ```sql
   -- Archive old events
   DELETE FROM events WHERE created_at < NOW() - INTERVAL '30 days';
   ```

2. **Increase memory limit:**
   ```yaml
   # docker-compose.yml
   deploy:
     resources:
       limits:
         memory: 4G
   ```

---

## Upgrading

```bash
# Pull latest changes
git pull origin main

# Install dependencies
pnpm install

# Build packages
pnpm build

# Restart server
docker compose restart server
```

Database migrations run automatically on server start.

---

## Support

- [GitHub Issues](https://github.com/scanwarp/scanwarp/issues)
- [Discord](https://discord.gg/scanwarp) (coming soon)
- Email: support@scanwarp.com (coming soon)
