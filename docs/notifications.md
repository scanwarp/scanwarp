# Notifications

Send incident alerts to Discord or Slack with full AI diagnosis and fix prompts.

## Quick Setup

### Discord

1. Create a webhook in Discord:
   - Server Settings → Integrations → Webhooks → New Webhook
   - Copy the webhook URL

2. Add to ScanWarp:
   ```bash
   curl -X POST http://localhost:3000/channels \
     -H "Content-Type: application/json" \
     -d '{
       "project_id": "your-project-id",
       "type": "discord",
       "webhook_url": "https://discord.com/api/webhooks/..."
     }'
   ```

3. Test it:
   ```bash
   curl -X POST http://localhost:3000/channels/{channel-id}/test
   ```

### Slack

1. Create a webhook in Slack:
   - Go to https://api.slack.com/apps
   - Create New App → From scratch
   - Incoming Webhooks → Activate → Add New Webhook
   - Copy the webhook URL

2. Add to ScanWarp:
   ```bash
   curl -X POST http://localhost:3000/channels \
     -H "Content-Type: application/json" \
     -d '{
       "project_id": "your-project-id",
       "type": "slack",
       "webhook_url": "https://hooks.slack.com/services/..."
     }'
   ```

3. Test it:
   ```bash
   curl -X POST http://localhost:3000/channels/{channel-id}/test
   ```

---

## What Gets Sent

When an incident is created, ScanWarp automatically sends a notification with:

### Discord Format

Rich embed with color-coded severity:
- **Red** — Critical incidents
- **Orange** — Warnings
- **Blue** — Info

Includes:
- Root cause diagnosis
- Suggested fix
- Correlated events (if any)
- Fix prompt in footer (or full prompt if long)
- Timestamp

**Example:**

```
🔴 ScanWarp — CRITICAL Incident

📊 What Happened
Your checkout API is returning 500 errors due to a null
pointer exception when processing invalid discount codes.

🔧 Suggested Fix
Add a null check before accessing discount.amount in your
checkout handler. Return a proper error message instead
of crashing.

🔗 Related Events
• vercel: error - TypeError: Cannot read property 'amount' of null
• monitor: down - https://yourapp.com/api/checkout

Severity: CRITICAL        Status: INVESTIGATING

Fix Prompt: In apps/api/checkout.ts, find the discount
validation and add: if (!discount) return { error: "Invalid
discount code" }; before accessing discount.amount...
```

### Slack Format

Formatted blocks with:
- Header with severity emoji
- Diagnosis sections
- Code block with fix prompt
- Timestamp context

**Example:**

```
🔴 ScanWarp CRITICAL Incident

What Happened:
Your checkout API is returning 500 errors due to a null
pointer exception when processing invalid discount codes.

Suggested Fix:
Add a null check before accessing discount.amount in your
checkout handler. Return a proper error message instead
of crashing.

Severity: CRITICAL          Status: INVESTIGATING

Related Events:
• vercel: error - TypeError: Cannot read property 'amount'...
• monitor: down - https://yourapp.com/api/checkout

Copy this to your AI coding tool:
───────────────────────────────────────────────────────
In apps/api/checkout.ts, find the discount validation
and add: if (!discount) return { error: "Invalid discount
code" }; before accessing discount.amount...
───────────────────────────────────────────────────────

Incident created: 2024-01-01 12:34:56
```

---

## Resolution Notifications

When you resolve an incident (via API or MCP), ScanWarp sends a follow-up:

### Discord
```
✅ Incident Resolved

Duration: 23 minutes
Status: RESOLVED

Resolved at: 2024-01-01 12:57:30
```

### Slack
```
✅ Incident Resolved

Duration: 23 minutes
Status: RESOLVED

Resolved at: 2024-01-01 12:57:30
```

---

## Rate Limiting

To prevent notification fatigue:

1. **Max 1 notification per incident per channel**
   - Same incident won't spam you repeatedly

2. **Max 10 notifications per hour per channel**
   - Prevents flooding during outages

3. **Severity-based timing** (future):
   - Critical → Immediate
   - Warning → Wait 5 minutes (might self-resolve)
   - Info → Daily digest

If rate limit is hit, the notification is silently dropped and logged.

---

## Managing Channels

### List Channels

```bash
curl http://localhost:3000/channels?project_id=your-project-id
```

### Disable Channel

```bash
curl -X POST http://localhost:3000/channels/{channel-id}/toggle \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'
```

### Delete Channel

```bash
curl -X DELETE http://localhost:3000/channels/{channel-id}
```

### Test Channel

```bash
curl -X POST http://localhost:3000/channels/{channel-id}/test
```

Sends a test notification to verify webhooks are working.

---

## Multiple Channels

You can add multiple channels per project:

```bash
# Production alerts to Discord
curl -X POST http://localhost:3000/channels \
  -d '{
    "project_id": "prod-project-id",
    "type": "discord",
    "webhook_url": "https://discord.com/api/webhooks/prod..."
  }'

# Also send to Slack
curl -X POST http://localhost:3000/channels \
  -d '{
    "project_id": "prod-project-id",
    "type": "slack",
    "webhook_url": "https://hooks.slack.com/services/prod..."
  }'

# Staging alerts to different Discord channel
curl -X POST http://localhost:3000/channels \
  -d '{
    "project_id": "staging-project-id",
    "type": "discord",
    "webhook_url": "https://discord.com/api/webhooks/staging..."
  }'
```

---

## Troubleshooting

### Not receiving notifications

1. **Check channel is enabled:**
   ```bash
   curl http://localhost:3000/channels?project_id=your-project-id
   ```
   Look for `"enabled": true`

2. **Test the webhook:**
   ```bash
   curl -X POST http://localhost:3000/channels/{channel-id}/test
   ```
   Should receive a test notification immediately

3. **Check webhook URL is correct:**
   - Discord webhooks start with `https://discord.com/api/webhooks/`
   - Slack webhooks start with `https://hooks.slack.com/services/`

4. **Verify incident was created:**
   ```bash
   curl http://localhost:3000/incidents?project_id=your-project-id
   ```
   If no incidents, nothing to notify about

5. **Check rate limits:**
   - Look at server logs for "Rate limit exceeded" messages
   - Only 1 notification per incident per channel

### Notification formatting looks wrong

- Discord: Webhooks must support embeds (most channels do)
- Slack: Webhooks must support Block Kit (all incoming webhooks do)

### Getting duplicate notifications

This shouldn't happen — rate limiting ensures max 1 per incident per channel. If you see duplicates:

1. Check you don't have multiple channels with the same webhook URL
2. Check server logs for errors
3. Report as a bug

---

## API Reference

See [API documentation](api.md#notification-channels) for complete endpoint reference.

---

## Coming Soon

- **Email notifications** — Send to email addresses
- **PagerDuty integration** — Create incidents in PagerDuty
- **Notification schedules** — Only notify during business hours
- **Severity filters** — Only notify for critical incidents
- **Digest mode** — Daily/weekly summary emails
