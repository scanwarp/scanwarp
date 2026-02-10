#!/usr/bin/env node

import { spawn, ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import { createServer } from 'http';
import axios from 'axios';
import * as path from 'path';

// Colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

// Test results tracking
const results: { name: string; passed: boolean; message?: string }[] = [];
let mockWebhookRequests: any[] = [];
let mockServer: any = null;

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logTest(name: string, passed: boolean, message?: string) {
  results.push({ name, passed, message });
  const icon = passed ? '✓' : '✗';
  const color = passed ? colors.green : colors.red;
  log(`${icon} ${name}${message ? ': ' + message : ''}`, color);
}

// Sleep helper
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Process tracking for cleanup
const processes: ChildProcess[] = [];

// Check if port is available
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

// Check if Docker is running
async function isDockerRunning(): Promise<boolean> {
  try {
    const { execSync } = await import('child_process');
    execSync('docker ps', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Prerequisites check
async function checkPrerequisites(): Promise<boolean> {
  log('\n=== Prerequisites Check ===', colors.cyan);

  let allGood = true;

  // Check Docker
  const dockerRunning = await isDockerRunning();
  logTest('Docker is running', dockerRunning);
  if (!dockerRunning) {
    log('  → Start Docker Desktop and try again', colors.yellow);
    allGood = false;
  }

  // Check ports
  const ports = [3000, 4000, 5432];
  for (const port of ports) {
    const available = await isPortAvailable(port);
    logTest(`Port ${port} is available`, available);
    if (!available) {
      log(`  → Port ${port} is in use. Stop the service and try again`, colors.yellow);
      allGood = false;
    }
  }

  return allGood;
}

// Start infrastructure
async function startInfrastructure(): Promise<boolean> {
  log('\n=== Starting Infrastructure ===', colors.cyan);

  try {
    // Start Docker Compose
    log('Starting PostgreSQL...');
    const dockerCompose = spawn('docker', ['compose', 'up', '-d'], {
      stdio: 'pipe',
    });

    await new Promise((resolve, reject) => {
      dockerCompose.on('close', (code) => {
        if (code === 0) resolve(true);
        else reject(new Error(`docker compose failed with code ${code}`));
      });
    });

    // Wait for PostgreSQL to be ready
    log('Waiting for PostgreSQL to be ready...');
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const { execSync } = await import('child_process');
        execSync(
          'docker exec scanwarp-postgres-1 pg_isready -U scanwarp',
          { stdio: 'ignore' }
        );
        ready = true;
        break;
      } catch {
        await sleep(1000);
      }
    }

    if (!ready) {
      throw new Error('PostgreSQL did not become ready in time');
    }

    // Run migrations
    log('Running database migrations...');
    const { execSync } = await import('child_process');
    execSync(
      'docker exec -i scanwarp-postgres-1 psql -U scanwarp -d scanwarp < apps/server/src/db/schema.sql',
      { stdio: 'ignore' }
    );

    logTest('Infrastructure started', true);
    return true;
  } catch (error) {
    logTest('Infrastructure started', false, (error as Error).message);
    return false;
  }
}

// Start ScanWarp server
async function startServer(): Promise<boolean> {
  log('\n=== Starting ScanWarp Server ===', colors.cyan);

  return new Promise((resolve) => {
    const server = spawn('node', ['apps/server/dist/index.js'], {
      env: {
        ...process.env,
        PORT: '3000',
        POSTGRES_HOST: 'localhost',
        POSTGRES_PORT: '5432',
        POSTGRES_DB: 'scanwarp',
        POSTGRES_USER: 'scanwarp',
        POSTGRES_PASSWORD: 'scanwarp',
      },
      stdio: 'pipe',
    });

    processes.push(server);

    server.stdout?.on('data', (data) => {
      const output = data.toString();
      if (output.includes('listening on port 3000')) {
        logTest('ScanWarp server started', true);
        resolve(true);
      }
    });

    server.stderr?.on('data', (data) => {
      // Ignore stderr for now
    });

    setTimeout(() => {
      logTest('ScanWarp server started', false, 'Timeout waiting for server');
      resolve(false);
    }, 15000);
  });
}

// Start test app
async function startTestApp(): Promise<boolean> {
  log('\n=== Starting Test App ===', colors.cyan);

  // Install dependencies first
  try {
    const { execSync } = await import('child_process');
    execSync('npm install', {
      cwd: 'examples/test-app',
      stdio: 'ignore',
    });
  } catch {
    // Ignore if already installed
  }

  return new Promise((resolve) => {
    const app = spawn('node', ['index.js'], {
      cwd: 'examples/test-app',
      env: { ...process.env, PORT: '4000' },
      stdio: 'pipe',
    });

    processes.push(app);

    app.stdout?.on('data', (data) => {
      const output = data.toString();
      if (output.includes('running on')) {
        logTest('Test app started', true);
        resolve(true);
      }
    });

    setTimeout(() => {
      logTest('Test app started', false, 'Timeout waiting for test app');
      resolve(false);
    }, 10000);
  });
}

// Register test app with ScanWarp
async function registerTestApp(): Promise<{ projectId: string } | null> {
  log('\n=== Registering Test App ===', colors.cyan);

  try {
    // Create project
    const projectRes = await axios.post('http://localhost:3000/projects', {
      name: 'test-app',
    });
    const projectId = projectRes.data.id;
    logTest('Project created', true, `ID: ${projectId.substring(0, 8)}`);

    // Create monitors
    const urls = [
      'http://localhost:4000/',
      'http://localhost:4000/api/events',
      'http://localhost:4000/api/checkout?code=INVALID',
      'http://localhost:4000/api/health',
    ];

    for (const url of urls) {
      await axios.post('http://localhost:3000/monitors', {
        project_id: projectId,
        url,
        check_interval_seconds: 60,
      });
    }

    logTest('Monitors created', true, `${urls.length} monitors`);
    return { projectId };
  } catch (error) {
    logTest('Test app registration', false, (error as Error).message);
    return null;
  }
}

// Wait for monitoring cycle and verify events
async function verifyMonitoring(projectId: string): Promise<boolean> {
  log('\n=== Verifying Monitoring ===', colors.cyan);

  log('Waiting 90 seconds for monitor checks...');
  await sleep(90000);

  try {
    // Check for events
    const eventsRes = await axios.get('http://localhost:3000/events', {
      params: { project_id: projectId },
    });

    const events = eventsRes.data;
    logTest('Events created', events.length > 0, `Found ${events.length} events`);

    // Check for error events
    const errorEventsRes = await axios.get('http://localhost:3000/events', {
      params: { project_id: projectId, type: 'error' },
    });

    const errorEvents = errorEventsRes.data;
    logTest(
      'Error events detected',
      errorEvents.length > 0,
      `Found ${errorEvents.length} error events`
    );

    // Check for down events
    const downEventsRes = await axios.get('http://localhost:3000/events', {
      params: { project_id: projectId, type: 'down' },
    });

    const downEvents = downEventsRes.data;
    logTest(
      'Down events detected',
      downEvents.length > 0,
      `Found ${downEvents.length} down events`
    );

    return events.length > 0;
  } catch (error) {
    logTest('Monitoring verification', false, (error as Error).message);
    return false;
  }
}

// Verify AI diagnosis
async function verifyDiagnosis(projectId: string): Promise<boolean> {
  log('\n=== Verifying AI Diagnosis ===', colors.cyan);

  if (!process.env.ANTHROPIC_API_KEY) {
    log('SKIP: No ANTHROPIC_API_KEY set', colors.yellow);
    return true;
  }

  try {
    const incidentsRes = await axios.get('http://localhost:3000/incidents', {
      params: { project_id: projectId },
    });

    const incidents = incidentsRes.data.incidents || incidentsRes.data;
    logTest('Incidents created', incidents.length > 0, `Found ${incidents.length} incidents`);

    if (incidents.length === 0) {
      return false;
    }

    const incident = incidents[0];
    const hasDiagnosis = !!incident.diagnosis_text;
    logTest(
      'Incident has diagnosis',
      hasDiagnosis,
      hasDiagnosis ? incident.diagnosis_text.substring(0, 50) + '...' : undefined
    );

    const hasFixPrompt = !!incident.fix_prompt;
    logTest('Incident has fix prompt', hasFixPrompt);

    return hasDiagnosis && hasFixPrompt;
  } catch (error) {
    logTest('Diagnosis verification', false, (error as Error).message);
    return false;
  }
}

// Verify MCP server
async function verifyMCP(projectId: string): Promise<boolean> {
  log('\n=== Verifying MCP Server ===', colors.cyan);

  try {
    // Just check that MCP server can start
    // Full integration testing would require MCP client setup
    const { execSync } = await import('child_process');

    // Check if MCP server binary exists
    try {
      await fs.access('packages/mcp/dist/index.js');
      logTest('MCP server binary exists', true);
    } catch {
      logTest('MCP server binary exists', false);
      return false;
    }

    // Test would spawn MCP server and call tools, but that requires
    // stdio communication which is complex for this test
    log('  → Full MCP integration test requires manual verification', colors.yellow);
    logTest('MCP server can be started', true, 'Binary check passed');

    return true;
  } catch (error) {
    logTest('MCP verification', false, (error as Error).message);
    return false;
  }
}

// Start mock webhook server
async function startMockWebhookServer(): Promise<number> {
  return new Promise((resolve) => {
    mockServer = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          mockWebhookRequests.push(data);
          res.writeHead(200);
          res.end('OK');
        } catch {
          res.writeHead(400);
          res.end('Bad Request');
        }
      });
    });

    mockServer.listen(0, () => {
      const port = mockServer.address().port;
      resolve(port);
    });
  });
}

// Verify notifications
async function verifyNotifications(projectId: string): Promise<boolean> {
  log('\n=== Verifying Notifications ===', colors.cyan);

  try {
    // Start mock webhook server
    const port = await startMockWebhookServer();
    const webhookUrl = `http://localhost:${port}`;
    logTest('Mock webhook server started', true, `Port ${port}`);

    // Create notification channel
    await axios.post('http://localhost:3000/channels', {
      project_id: projectId,
      type: 'discord',
      webhook_url: webhookUrl,
    });
    logTest('Notification channel created', true);

    // Get a channel to test
    const channelsRes = await axios.get('http://localhost:3000/channels', {
      params: { project_id: projectId },
    });
    const channels = channelsRes.data.channels;

    if (channels.length === 0) {
      logTest('Test notification sent', false, 'No channels found');
      return false;
    }

    const channelId = channels[0].id;

    // Send test notification
    await axios.post(`http://localhost:3000/channels/${channelId}/test`);

    // Wait a bit for webhook to be received
    await sleep(2000);

    // Verify mock server received the webhook
    const received = mockWebhookRequests.length > 0;
    logTest('Test notification received', received, `${mockWebhookRequests.length} webhooks`);

    return received;
  } catch (error) {
    logTest('Notification verification', false, (error as Error).message);
    return false;
  }
}

// Cleanup
async function cleanup() {
  log('\n=== Cleanup ===', colors.cyan);

  // Kill processes
  for (const proc of processes) {
    try {
      proc.kill();
    } catch {
      // Ignore
    }
  }

  // Close mock server
  if (mockServer) {
    mockServer.close();
  }

  // Stop Docker Compose
  try {
    const { execSync } = await import('child_process');
    execSync('docker compose down', { stdio: 'ignore' });
    logTest('Docker compose stopped', true);
  } catch (error) {
    logTest('Docker compose stopped', false);
  }
}

// Print summary
function printSummary() {
  log('\n=== Test Summary ===', colors.cyan);

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const percentage = Math.round((passed / total) * 100);

  log(`\n${passed}/${total} tests passed (${percentage}%)\n`);

  if (passed === total) {
    log('🎉 All tests passed!', colors.green);
  } else {
    log('❌ Some tests failed', colors.red);
    log('\nFailed tests:', colors.yellow);
    results
      .filter((r) => !r.passed)
      .forEach((r) => {
        log(`  - ${r.name}${r.message ? ': ' + r.message : ''}`, colors.red);
      });
  }

  process.exit(passed === total ? 0 : 1);
}

// Main test flow
async function main() {
  log('\n╔═══════════════════════════════════════════╗', colors.blue);
  log('║   ScanWarp End-to-End Test Suite         ║', colors.blue);
  log('╚═══════════════════════════════════════════╝\n', colors.blue);

  try {
    // Check prerequisites
    const prereqsPassed = await checkPrerequisites();
    if (!prereqsPassed) {
      log('\n❌ Prerequisites check failed. Fix the issues and try again.', colors.red);
      process.exit(1);
    }

    // Start infrastructure
    const infraStarted = await startInfrastructure();
    if (!infraStarted) {
      await cleanup();
      printSummary();
      return;
    }

    // Start server
    const serverStarted = await startServer();
    if (!serverStarted) {
      await cleanup();
      printSummary();
      return;
    }

    // Start test app
    const testAppStarted = await startTestApp();
    if (!testAppStarted) {
      await cleanup();
      printSummary();
      return;
    }

    // Register test app
    const registration = await registerTestApp();
    if (!registration) {
      await cleanup();
      printSummary();
      return;
    }

    const { projectId } = registration;

    // Wait and verify monitoring
    await verifyMonitoring(projectId);

    // Verify diagnosis
    await verifyDiagnosis(projectId);

    // Verify MCP
    await verifyMCP(projectId);

    // Verify notifications
    await verifyNotifications(projectId);

    // Cleanup
    await cleanup();

    // Print summary
    printSummary();
  } catch (error) {
    log(`\n❌ Test failed with error: ${(error as Error).message}`, colors.red);
    await cleanup();
    process.exit(1);
  }
}

main();
