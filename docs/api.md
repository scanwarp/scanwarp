# API Reference

Complete REST API documentation for ScanWarp.

## Base URL

```
http://localhost:3000
```

## Authentication

Currently no authentication required for local deployments. For production, use API tokens (coming soon).

---

## Projects

### Create Project

```http
POST /projects
```

**Request Body:**
```json
{
  "name": "my-app"
}
```

**Response:**
```json
{
  "success": true,
  "id": "550e8400-e29b-41d4-a716-446655440000"
}
```

### List Projects

```http
GET /projects
GET /projects?name=my-app
```

**Response:**
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "my-app",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
]
```

---

## Monitors

### Create Monitor

```http
POST /monitors
```

**Request Body:**
```json
{
  "project_id": "550e8400-e29b-41d4-a716-446655440000",
  "url": "https://yourapp.com/api/health",
  "check_interval_seconds": 60
}
```

**Response:**
```json
{
  "success": true,
  "id": "123e4567-e89b-12d3-a456-426614174000"
}
```

### List Monitors

```http
GET /monitors?project_id=550e8400-e29b-41d4-a716-446655440000
```

**Response:**
```json
{
  "monitors": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "project_id": "550e8400-e29b-41d4-a716-446655440000",
      "url": "https://yourapp.com/api/health",
      "check_interval_seconds": 60,
      "status": "up",
      "last_checked_at": "2024-01-01T00:00:00.000Z",
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### Get Monitor

```http
GET /monitors/:id
```

---

## Events

### List Events

```http
GET /events
```

**Query Parameters:**
- `project_id` (required) — Filter by project
- `type` — Filter by type: `error`, `slow`, `down`, `up`
- `source` — Filter by source: `monitor`, `vercel`, `stripe`, `github`, `supabase`, `provider-status`
- `severity` — Filter by severity: `critical`, `high`, `medium`, `low`
- `limit` — Number of events to return (default: 50)

**Example:**
```http
GET /events?project_id=550e8400-e29b-41d4-a716-446655440000&type=error&limit=10
```

**Response:**
```json
[
  {
    "id": "789e0123-e89b-12d3-a456-426614174000",
    "project_id": "550e8400-e29b-41d4-a716-446655440000",
    "monitor_id": "123e4567-e89b-12d3-a456-426614174000",
    "type": "error",
    "source": "vercel",
    "message": "TypeError: Cannot read property 'amount' of null",
    "severity": "high",
    "raw_data": { "stack": "..." },
    "created_at": "2024-01-01T00:00:00.000Z"
  }
]
```

---

## Incidents

### List Incidents

```http
GET /incidents
```

**Query Parameters:**
- `project_id` (required) — Filter by project
- `status` — Filter by status: `open`, `investigating`, `resolved`
- `severity` — Filter by severity: `critical`, `warning`, `info`
- `limit` — Number of incidents to return (default: 50)

**Example:**
```http
GET /incidents?project_id=550e8400-e29b-41d4-a716-446655440000&status=open
```

**Response:**
```json
{
  "incidents": [
    {
      "id": "abc12345-e89b-12d3-a456-426614174000",
      "project_id": "550e8400-e29b-41d4-a716-446655440000",
      "events": ["789e0123-e89b-12d3-a456-426614174000"],
      "status": "investigating",
      "severity": "critical",
      "diagnosis_text": "Your checkout API is crashing because it's trying to access a property on a null object.",
      "diagnosis_fix": "Add a null check before accessing discount.amount in your checkout handler.",
      "fix_prompt": "In apps/api/checkout.ts, add a check: if (!discount) return error...",
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### Get Incident Detail

```http
GET /incidents/:id
```

**Response:**
```json
{
  "incident": {
    "id": "abc12345-e89b-12d3-a456-426614174000",
    "project_id": "550e8400-e29b-41d4-a716-446655440000",
    "events": ["789e0123-e89b-12d3-a456-426614174000"],
    "status": "investigating",
    "severity": "critical",
    "diagnosis_text": "...",
    "diagnosis_fix": "...",
    "fix_prompt": "...",
    "created_at": "2024-01-01T00:00:00.000Z"
  },
  "events": [
    {
      "id": "789e0123-e89b-12d3-a456-426614174000",
      "type": "error",
      "message": "TypeError: Cannot read property 'amount' of null",
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### Resolve Incident

```http
POST /incidents/:id/resolve
```

**Response:**
```json
{
  "success": true,
  "message": "Incident resolved"
}
```

---

## Webhooks

### Vercel Log Drain

```http
POST /ingest/vercel
```

**Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
[
  {
    "source": "error",
    "message": "TypeError: Cannot read property 'amount' of null",
    "timestamp": 1704067200000,
    "type": "stderr"
  }
]
```

Automatically creates events for errors in your Vercel logs.

### Stripe Webhook

```http
POST /ingest/stripe
```

**Headers:**
```
Content-Type: application/json
Stripe-Signature: t=1704067200,v1=abc123...
```

**Request Body:**
```json
{
  "id": "evt_abc123",
  "type": "payment_intent.payment_failed",
  "data": {
    "object": { ... }
  }
}
```

Set `STRIPE_WEBHOOK_SECRET` to verify signatures.

### GitHub Webhook

```http
POST /ingest/github
```

**Headers:**
```
Content-Type: application/json
X-Hub-Signature-256: sha256=abc123...
```

**Request Body:**
```json
{
  "action": "completed",
  "workflow_run": {
    "conclusion": "failure",
    "name": "CI",
    "html_url": "https://github.com/..."
  }
}
```

Set `GITHUB_WEBHOOK_SECRET` to verify signatures.

---

## Notification Channels

### Create Channel

```http
POST /channels
```

**Request Body:**
```json
{
  "project_id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "discord",
  "webhook_url": "https://discord.com/api/webhooks/..."
}
```

**Response:**
```json
{
  "success": true,
  "channel": {
    "id": "def45678-e89b-12d3-a456-426614174000",
    "project_id": "550e8400-e29b-41d4-a716-446655440000",
    "type": "discord",
    "enabled": true,
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

### List Channels

```http
GET /channels?project_id=550e8400-e29b-41d4-a716-446655440000
```

### Delete Channel

```http
DELETE /channels/:id
```

### Toggle Channel

```http
POST /channels/:id/toggle
```

**Request Body:**
```json
{
  "enabled": false
}
```

### Test Channel

```http
POST /channels/:id/test
```

Sends a test notification to verify the webhook is working.

---

## Health Check

```http
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

## Rate Limits

Currently no rate limits for local deployments. Production deployments will have:

- 100 requests per minute per IP
- 1000 events per minute per project
- 10 notifications per hour per channel

---

## Errors

All endpoints return errors in this format:

```json
{
  "success": false,
  "message": "Error message here"
}
```

Common HTTP status codes:
- `200` — Success
- `400` — Bad request (missing or invalid parameters)
- `404` — Not found
- `500` — Internal server error
