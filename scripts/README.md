# ScanWarp E2E Test Suite

Comprehensive end-to-end test that validates the entire ScanWarp pipeline.

## What It Tests

1. **Prerequisites** - Docker running, ports available
2. **Infrastructure** - PostgreSQL startup and migrations
3. **Server Startup** - ScanWarp server initialization
4. **Test App** - Express app with intentional bugs
5. **Registration** - Project and monitor creation via API
6. **Monitoring** - Health checks and event detection
7. **Diagnosis** - AI-powered incident diagnosis (requires API key)
8. **MCP Server** - Binary check and validation
9. **Notifications** - Webhook delivery verification

## Usage

### Prerequisites

- Docker Desktop running
- Ports 3000, 4000, 5432 available
- ScanWarp built (`pnpm build` from root)
- (Optional) `ANTHROPIC_API_KEY` for diagnosis tests

### Run Tests

From the root of the project:

```bash
# Install dependencies
cd scripts
npm install

# Run E2E tests
npm run e2e
```

Or directly with tsx:

```bash
cd scripts
npx tsx e2e-test.ts
```

## Expected Output

```
╔═══════════════════════════════════════════╗
║   ScanWarp End-to-End Test Suite         ║
╚═══════════════════════════════════════════╝

=== Prerequisites Check ===
✓ Docker is running
✓ Port 3000 is available
✓ Port 4000 is available
✓ Port 5432 is available

=== Starting Infrastructure ===
Starting PostgreSQL...
Waiting for PostgreSQL to be ready...
Running database migrations...
✓ Infrastructure started

=== Starting ScanWarp Server ===
✓ ScanWarp server started

=== Starting Test App ===
✓ Test app started

=== Registering Test App ===
✓ Project created: ID: 12345678
✓ Monitors created: 4 monitors

=== Verifying Monitoring ===
Waiting 90 seconds for monitor checks...
✓ Events created: Found 8 events
✓ Error events detected: Found 2 error events
✓ Down events detected: Found 1 down events

=== Verifying AI Diagnosis ===
✓ Incidents created: Found 1 incidents
✓ Incident has diagnosis: Checkout endpoint failing due to...
✓ Incident has fix prompt

=== Verifying MCP Server ===
✓ MCP server binary exists
  → Full MCP integration test requires manual verification
✓ MCP server can be started: Binary check passed

=== Verifying Notifications ===
✓ Mock webhook server started: Port 54321
✓ Notification channel created
✓ Test notification received: 1 webhooks

=== Cleanup ===
✓ Docker compose stopped

=== Test Summary ===

18/18 tests passed (100%)

🎉 All tests passed!
```

## Test Components

### Test App (`examples/test-app/`)

Minimal Express server with intentional bugs:

- `GET /` - Homepage
- `GET /api/events` - Events log
- `GET /api/checkout?code=INVALID` - **Crashes with 500 error** (bug)
- `GET /api/health` - Health check

The checkout endpoint has an intentional null pointer bug that ScanWarp should detect and diagnose.

### Test Flow

1. Starts PostgreSQL container
2. Runs database migrations
3. Starts ScanWarp server
4. Starts buggy test app
5. Registers 4 monitors pointing to test app
6. Waits 90 seconds for monitoring cycle
7. Verifies events were created for the crash
8. Verifies AI diagnosis identified the issue
9. Verifies MCP server binary is functional
10. Creates mock webhook server
11. Verifies notification delivery
12. Cleans up all resources

## Troubleshooting

### Tests fail immediately

- Check Docker Desktop is running
- Ensure ports 3000, 4000, 5432 are not in use
- Run `pnpm build` from project root

### Monitoring tests fail

- Increase wait time in the script (currently 90s)
- Check test app logs for errors
- Verify monitors were created correctly

### Diagnosis tests skipped

- Set `ANTHROPIC_API_KEY` environment variable
- Tests will skip gracefully without API key

### Cleanup fails

- Manually run `docker compose down`
- Kill processes on ports 3000, 4000
- Check `docker ps` for running containers

## CI Integration

Add to GitHub Actions:

```yaml
- name: Run E2E Tests
  run: |
    cd scripts
    npm install
    npm run e2e
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Notes

- Full test takes ~2 minutes to complete
- Mock webhook server uses random port to avoid conflicts
- All resources are cleaned up automatically
- Exit code 0 = all tests passed, 1 = failures
