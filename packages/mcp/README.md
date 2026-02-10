# @scanwarp/mcp

MCP (Model Context Protocol) server for ScanWarp. This lets Cursor and Claude Code directly access your application's monitoring data and incident information.

## What It Does

When you configure this MCP server in your AI coding assistant, the AI can instantly access:

- **Current app health** - "Is my app healthy right now?"
- **Active incidents** - "What's wrong with my app?"
- **Incident details** - "Show me the full diagnosis for incident X"
- **Fix prompts** - "Give me the exact prompt to fix this issue"
- **Recent events** - "What errors happened in the last hour?"
- **Resolve incidents** - "Mark incident X as resolved"

## Quick Start

### Cursor Configuration

Add to `.cursor/mcp.json`:

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
        "your-project-id"
      ]
    }
  }
}
```

### Claude Desktop Configuration

Add to `claude_desktop_config.json`:

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
        "your-project-id"
      ]
    }
  }
}
```

## Configuration Options

### Command Line Arguments

- `--server <url>` - ScanWarp server URL (default: http://localhost:3000)
- `--token <token>` - API authentication token (optional)
- `--project <id>` - Default project ID (required for resources)

### Environment Variables

Alternatively, you can use environment variables:

- `SCANWARP_SERVER_URL` - Server URL
- `SCANWARP_API_TOKEN` - API token
- `SCANWARP_PROJECT_ID` - Default project ID

## Available Tools

### get_app_status

Get overall health status of your application.

**Example conversation:**
```
Developer: "Is my app healthy?"
AI: Calls get_app_status → "Your app is healthy. 4 monitors all passing. No active incidents. All providers operational."
```

### get_incidents

List incidents with diagnosis and fix suggestions. Filter by status or severity.

**Example conversation:**
```
Developer: "What incidents do I have?"
AI: Calls get_incidents → Shows list of active incidents with summaries
```

### get_incident_detail

Get full details for a specific incident including root cause, timeline, and fix prompt.

**Example conversation:**
```
Developer: "Tell me more about incident abc123"
AI: Calls get_incident_detail → Shows full diagnosis with fix prompt
```

### get_fix_prompt

Get JUST the fix prompt for an incident - ready to use.

**Example conversation:**
```
Developer: "Give me a prompt to fix incident abc123"
AI: Calls get_fix_prompt → Returns the exact prompt to paste in AI tool
```

### get_events

Get recent events with filters (type, source, severity).

**Example conversation:**
```
Developer: "Show me recent errors"
AI: Calls get_events with type='error' → Lists recent error events
```

### resolve_incident

Mark an incident as resolved. Triggers resolution notifications.

**Example conversation:**
```
Developer: "Mark incident abc123 as resolved"
AI: Calls resolve_incident → "Incident has been marked as resolved"
```

## Resources

If you configure a default project ID, the MCP server exposes two resources:

### scanwarp://status

Current app health summary. The AI can reference this automatically for context.

### scanwarp://incidents

List of active incidents. The AI can reference this automatically for context.

## Example Workflow

1. Developer opens Cursor and starts working
2. Developer asks: "What's wrong with my app?"
3. AI calls `get_app_status` → sees there's a critical incident
4. AI calls `get_incident_detail` → gets full diagnosis
5. AI calls `get_fix_prompt` → gets the fix prompt
6. AI presents the issue and suggests the fix
7. Developer implements the fix
8. Developer says "Mark it as resolved"
9. AI calls `resolve_incident` → incident closed, notifications sent

## Development

Build the package:

```bash
pnpm install
pnpm build
```

Run locally:

```bash
node dist/index.js --server http://localhost:3000 --project your-project-id
```

## Notes

- All tool responses are in plain English, not JSON dumps
- The AI receives concise, colleague-style status updates
- Error handling is graceful - errors return helpful messages
- Resources auto-update so the AI always has fresh context
