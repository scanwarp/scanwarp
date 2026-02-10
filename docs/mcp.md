# MCP Integration

Connect Cursor or Claude Code directly to your ScanWarp monitoring data using the Model Context Protocol.

## What You Get

When configured, your AI coding assistant can:

- Check app health: "Is my app healthy?"
- List incidents: "What's broken?"
- Get full diagnosis: "Show me incident details"
- Get fix prompts: "How do I fix this?"
- Query events: "Show recent errors"
- Resolve incidents: "Mark this as fixed"

**The AI has instant access to your production monitoring data.**

---

## Setup for Cursor

1. Find your project ID:
   ```bash
   npx scanwarp status
   # Look for "Project ID: abc123..."
   ```

2. Create `.cursor/mcp.json` in your project root:
   ```json
   {
     "mcpServers": {
       "scanwarp": {
         "command": "npx",
         "args": [
           "@scanwarp/mcp",
           "--server",
           "http://localhost:3000",
           "--project",
           "your-project-id-here"
         ]
       }
     }
   }
   ```

3. Restart Cursor

4. Ask: "What's wrong with my app?"

---

## Setup for Claude Desktop

1. Find your project ID (same as above)

2. On macOS, edit `~/Library/Application Support/Claude/claude_desktop_config.json`

   On Windows, edit `%APPDATA%\Claude\claude_desktop_config.json`

   ```json
   {
     "mcpServers": {
       "scanwarp": {
         "command": "npx",
         "args": [
           "@scanwarp/mcp",
           "--server",
           "http://localhost:3000",
           "--project",
           "your-project-id-here"
         ]
       }
     }
   }
   ```

3. Restart Claude Desktop

4. Ask: "Check my app status"

---

## Configuration Options

### Command Line Arguments

```json
{
  "mcpServers": {
    "scanwarp": {
      "command": "npx",
      "args": [
        "@scanwarp/mcp",
        "--server", "http://localhost:3000",
        "--project", "your-project-id",
        "--token", "optional-api-token"
      ]
    }
  }
}
```

- `--server` — ScanWarp server URL (default: http://localhost:3000)
- `--project` — Your project ID (required for auto-context)
- `--token` — API token for authentication (optional)

### Environment Variables

Alternatively, set these in your shell:

```bash
export SCANWARP_SERVER_URL=http://localhost:3000
export SCANWARP_PROJECT_ID=your-project-id
export SCANWARP_API_TOKEN=your-token
```

Then simplify your MCP config:

```json
{
  "mcpServers": {
    "scanwarp": {
      "command": "npx",
      "args": ["@scanwarp/mcp"]
    }
  }
}
```

---

## Available Tools

### `get_app_status`

Returns overall health in plain English.

**Example:**
```
You: "Is my app healthy?"
AI: [Calls get_app_status with your project_id]
    "✅ Your app is healthy. 4 monitors all passing.
     No active incidents. All providers operational."
```

### `get_incidents`

Lists incidents with summaries.

**Parameters:**
- `project_id` (required)
- `status` — Filter: `open`, `resolved`
- `severity` — Filter: `critical`, `warning`, `info`
- `limit` — Number to return (default: 10)

**Example:**
```
You: "Show me critical incidents"
AI: [Calls get_incidents with severity=critical]
    "Found 1 incident:
     🔴 Incident #abc12345
        Severity: CRITICAL
        Issue: Checkout API returning 500s..."
```

### `get_incident_detail`

Full diagnosis with timeline and fix prompt.

**Parameters:**
- `incident_id` (required)

**Example:**
```
You: "Tell me about incident abc123"
AI: [Calls get_incident_detail]
    "🔴 Incident #abc123

     ROOT CAUSE:
     Your checkout API is crashing because...

     SUGGESTED FIX:
     Add a null check before accessing...

     FIX PROMPT:
     ──────────────────────────────────
     In apps/api/checkout.ts, find the
     discount validation and add...
     ──────────────────────────────────"
```

### `get_fix_prompt`

Returns JUST the fix prompt — nothing else.

**Parameters:**
- `incident_id` (required)

**Example:**
```
You: "Give me a fix prompt for abc123"
AI: [Calls get_fix_prompt]
    "In apps/api/checkout.ts, find the discount
     validation and add a null check before
     accessing discount.amount..."
```

### `get_events`

Query recent events with filters.

**Parameters:**
- `project_id` (required)
- `type` — Filter: `error`, `slow`, `down`, `up`
- `source` — Filter: `monitor`, `vercel`, `stripe`, `github`
- `severity` — Filter: `critical`, `high`, `medium`, `low`
- `limit` — Number to return (default: 20)

**Example:**
```
You: "Show me Vercel errors from the last hour"
AI: [Calls get_events with source=vercel, type=error]
    "Found 3 recent events:
     🔴 [vercel] error - 5 minutes ago
        TypeError: Cannot read property..."
```

### `resolve_incident`

Mark an incident as resolved.

**Parameters:**
- `incident_id` (required)

**Example:**
```
You: "Mark incident abc123 as resolved"
AI: [Calls resolve_incident]
    "✅ Incident #abc123 has been marked as
     resolved. Resolution notifications have
     been sent to configured channels."
```

---

## Resources

If you configure a `--project` ID, the MCP server exposes two auto-updating resources:

### `scanwarp://status`

Current app health summary. The AI can reference this automatically for ambient context.

### `scanwarp://incidents`

List of active incidents. The AI can check this proactively.

---

## Example Workflow

**Morning standup:**

```
You: "What happened overnight?"
AI: [Reads scanwarp://status and scanwarp://incidents]
    "You have 1 critical incident. Your payment
     processing API started failing around 2am..."

You: "Show me the fix"
AI: [Calls get_fix_prompt]
    "Here's what to do: In apps/api/stripe.ts..."

You: "Do it"
AI: [Applies the fix using Edit tools]
    "Done. I've added the null check and error
     handling. Want me to mark the incident as
     resolved?"

You: "Yes"
AI: [Calls resolve_incident]
    "Incident resolved. Team notified via Slack."
```

---

## Troubleshooting

### MCP server not appearing

1. Check the config file location is correct
2. Restart your AI assistant completely
3. Check for typos in the JSON
4. Run `npx @scanwarp/mcp` directly to test

### "Error: SCANWARP_SERVER_URL is not configured"

Make sure `--server` is in your args, or set the env var.

### "Error: SCANWARP_PROJECT_ID not configured"

Resources won't work without `--project`. Tools will still work if you pass `project_id` manually.

### Tools returning errors

1. Check ScanWarp server is running: `curl http://localhost:3000/health`
2. Verify project ID exists: `npx scanwarp status`
3. Check server logs for errors

---

## Development

Build the MCP server:

```bash
cd packages/mcp
pnpm install
pnpm build
```

Test locally:

```bash
node dist/index.js --server http://localhost:3000 --project your-project-id
```

The server runs over stdio and communicates via JSON-RPC with your AI assistant.

---

## How It Works

The MCP server:

1. Connects to your ScanWarp server via REST API
2. Exposes tools that your AI can call
3. Formats responses in plain English (not JSON dumps)
4. Auto-updates resources every time the AI checks them
5. Handles errors gracefully with helpful messages

**Your AI coding assistant becomes aware of your production issues** and can help you fix them in real-time.
