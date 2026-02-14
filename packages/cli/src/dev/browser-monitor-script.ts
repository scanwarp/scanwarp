/**
 * Browser monitoring script - embedded as string for easy serving
 */

export const BROWSER_MONITOR_SCRIPT = `
/**
 * ScanWarp Browser Monitor
 * Injected into user's app during dev to capture frontend errors
 * Reports to local ScanWarp dev server
 */

(function() {
  const SCANWARP_SERVER = '__SCANWARP_SERVER__';
  const errors = [];

  // Capture console.error
  const originalError = console.error;
  console.error = function(...args) {
    captureError({
      type: 'console.error',
      message: args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' '),
      timestamp: Date.now(),
      stack: new Error().stack
    });
    originalError.apply(console, args);
  };

  // Capture unhandled errors
  window.addEventListener('error', (event) => {
    captureError({
      type: 'unhandled_error',
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error?.stack,
      timestamp: Date.now()
    });
  });

  // Capture unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    captureError({
      type: 'unhandled_rejection',
      message: event.reason?.message || String(event.reason),
      stack: event.reason?.stack,
      timestamp: Date.now()
    });
  });

  // Capture React errors (if React is present)
  setTimeout(() => {
    if (window.React && window.ReactDOM) {
      const originalErrorHandler = window.React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?.ReactDebugCurrentFrame?.setExtraStackFrame;
      if (originalErrorHandler) {
        window.React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactDebugCurrentFrame.setExtraStackFrame = function(stack) {
          captureError({
            type: 'react_error',
            message: 'React rendering error',
            stack: stack,
            timestamp: Date.now()
          });
          originalErrorHandler.call(this, stack);
        };
      }
    }
  }, 100);

  // Check if app rendered (detect blank screen)
  setTimeout(() => {
    const body = document.body;
    const hasContent = body && (body.children.length > 1 || body.textContent.trim().length > 0);

    if (!hasContent) {
      captureError({
        type: 'blank_screen',
        message: 'Page rendered but appears blank - no content in body',
        timestamp: Date.now(),
        html: document.documentElement.outerHTML.slice(0, 500)
      });
    }
  }, 2000);

  // Send error to ScanWarp server
  function captureError(error) {
    errors.push(error);

    // Send to server
    fetch(SCANWARP_SERVER + '/dev/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: window.location.href,
        userAgent: navigator.userAgent,
        error: error
      })
    }).catch(() => {
      // Silently fail if server is down
    });
  }

  // Expose for debugging
  window.__scanwarp = {
    errors: errors,
    getErrors: () => errors,
    clearErrors: () => errors.length = 0
  };

  console.log('%c[ScanWarp] %cMonitoring for errors...', 'color: #3b82f6; font-weight: bold', 'color: #6b7280');
})();
`;
