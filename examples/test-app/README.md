# ScanWarp Test Application

A minimal Express server with intentional bugs for E2E testing.

## Purpose

This app simulates a real-world application with production issues that ScanWarp should detect and diagnose.

## Endpoints

### `GET /`
Homepage with links to all test endpoints.

### `GET /api/health`
Health check endpoint - always returns 200 OK.

```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 123.456
}
```

### `GET /api/events`
Returns all logged events from the application.

```json
{
  "success": true,
  "events": [...],
  "count": 42
}
```

### `GET /api/checkout?code=VALID20` ✅
Valid checkout with discount code.

```json
{
  "success": true,
  "discount": 20,
  "message": "Discount applied successfully!"
}
```

### `GET /api/checkout?code=INVALID` ❌
**Intentional Bug**: Any code except "VALID20" crashes the endpoint.

```
Error: Cannot read property 'amount' of null
Status: 500 Internal Server Error
```

This simulates a common programming mistake:

```javascript
const discount = null;
const percentage = discount.amount; // 💥 Throws error
```

## Running

```bash
# Install dependencies
npm install

# Start server
npm start

# Or specify port
PORT=4000 npm start
```

## Expected Behavior

When monitored by ScanWarp:

1. **Monitor `/` and `/api/health`** → Always passing ✅
2. **Monitor `/api/events`** → Always passing ✅
3. **Monitor `/api/checkout?code=INVALID`** → Always failing ❌

ScanWarp should:
- Detect the 500 error as a "down" event
- Create an "error" event in the events table
- Run anomaly detection (new error type)
- Create an incident with AI diagnosis
- Diagnose: "Checkout endpoint crashing due to null pointer exception"
- Suggest: "Add null check before accessing discount.amount"
- Generate fix prompt for AI coding tools

## Test Integration

This app is used by `scripts/e2e-test.ts` to validate the entire ScanWarp pipeline:

```bash
cd ../../scripts
npm run e2e
```

The E2E test will:
1. Start this app on port 4000
2. Register 4 monitors pointing to these endpoints
3. Wait 90 seconds for health checks
4. Verify error detection
5. Verify AI diagnosis
6. Clean up

## Manual Testing

Start the app and hit the buggy endpoint:

```bash
npm start

# In another terminal:
curl http://localhost:4000/api/checkout?code=INVALID
# Should return 500 error

curl http://localhost:4000/api/events
# Should show the error in the events log
```

## Customization

To add more test scenarios:

1. Add new endpoints with different types of bugs
2. Update `scripts/e2e-test.ts` to monitor them
3. Verify ScanWarp detects and diagnoses correctly
