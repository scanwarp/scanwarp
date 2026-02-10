import express from 'express';

const app = express();
const PORT = process.env.PORT || 4000;

// Track events for the events endpoint
const events = [];

function logEvent(type, message) {
  events.push({
    type,
    message,
    timestamp: new Date().toISOString(),
  });
  // Keep only last 100 events
  if (events.length > 100) {
    events.shift();
  }
}

// Homepage
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>ScanWarp Test App</title>
      </head>
      <body>
        <h1>ScanWarp Test Application</h1>
        <p>This is a test app for E2E testing.</p>
        <ul>
          <li><a href="/api/health">Health Check</a></li>
          <li><a href="/api/events">Events</a></li>
          <li><a href="/api/checkout?code=VALID20">Checkout (Valid)</a></li>
          <li><a href="/api/checkout?code=INVALID">Checkout (Invalid - Will Crash)</a></li>
        </ul>
      </body>
    </html>
  `);
  logEvent('info', 'Homepage visited');
});

// Events endpoint
app.get('/api/events', (req, res) => {
  res.json({
    success: true,
    events,
    count: events.length,
  });
  logEvent('info', 'Events endpoint accessed');
});

// Checkout endpoint with intentional bug
app.get('/api/checkout', (req, res) => {
  const { code } = req.query;

  // Log the attempt
  logEvent('info', `Checkout attempt with code: ${code || 'none'}`);

  // Valid code works fine
  if (code === 'VALID20') {
    return res.json({
      success: true,
      discount: 20,
      message: 'Discount applied successfully!',
    });
  }

  // INTENTIONAL BUG: Any other code throws an unhandled error
  // This simulates a common programming mistake
  logEvent('error', `Invalid discount code attempted: ${code}`);

  // Crash the route by trying to access undefined property
  const discount = null;
  const percentage = discount.amount; // Will throw: Cannot read property 'amount' of null

  // This code will never be reached
  res.json({ success: false });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
  logEvent('info', 'Health check performed');
});

// Error handler
app.use((err, req, res, next) => {
  console.error('ERROR:', err.message);
  logEvent('error', `Server error: ${err.message} at ${req.path}`);
  res.status(500).json({
    success: false,
    error: err.message,
  });
});

app.listen(PORT, () => {
  console.log(`Test app running on http://localhost:${PORT}`);
  logEvent('info', `Server started on port ${PORT}`);
});
