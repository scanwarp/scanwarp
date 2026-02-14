/**
 * ScanWarp Browser Monitoring
 * Production frontend error tracking
 */

interface BrowserError {
  type: string;
  message: string;
  stack?: string;
  timestamp: number;
  url: string;
  userAgent: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  sessionId: string;
}

interface ScanWarpConfig {
  serverUrl: string;
  projectId: string;
  sampleRate?: number;
  debug?: boolean;
  beforeSend?: (error: BrowserError) => BrowserError | null;
}

class ScanWarpBrowser {
  private config: ScanWarpConfig;
  private errorQueue: BrowserError[] = [];
  private sessionId: string;
  private flushInterval: number = 5000; // 5 seconds
  private maxQueueSize: number = 50;
  private retryCount: number = 0;
  private maxRetries: number = 3;

  constructor(config: ScanWarpConfig) {
    this.config = {
      sampleRate: 1.0,
      debug: false,
      ...config,
    };
    this.sessionId = this.generateSessionId();
    this.init();
  }

  private init() {
    // Sample rate check
    if (Math.random() > (this.config.sampleRate || 1.0)) {
      if (this.config.debug) {
        console.log('[ScanWarp] Sampling skipped this session');
      }
      return;
    }

    this.setupErrorHandlers();
    this.startFlushInterval();
    this.log('Initialized');
  }

  private setupErrorHandlers() {
    // Capture console.error
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      this.captureError({
        type: 'console.error',
        message: args
          .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
          .join(' '),
        timestamp: Date.now(),
        stack: new Error().stack,
      });
      originalError.apply(console, args);
    };

    // Capture unhandled errors
    window.addEventListener('error', (event) => {
      this.captureError({
        type: 'unhandled_error',
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack,
        timestamp: Date.now(),
      });
    });

    // Capture unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      this.captureError({
        type: 'unhandled_rejection',
        message: event.reason?.message || String(event.reason),
        stack: event.reason?.stack,
        timestamp: Date.now(),
      });
    });

    // Check for blank screen after page load
    window.addEventListener('load', () => {
      setTimeout(() => {
        this.checkBlankScreen();
      }, 2000);
    });

    // Network errors
    this.interceptFetch();
    this.interceptXHR();
  }

  private checkBlankScreen() {
    const body = document.body;
    const hasContent =
      body && (body.children.length > 1 || (body.textContent?.trim().length || 0) > 0);

    if (!hasContent) {
      this.captureError({
        type: 'blank_screen',
        message: 'Page rendered but appears blank - no content in body',
        timestamp: Date.now(),
      });
    }
  }

  private interceptFetch() {
    const originalFetch = window.fetch;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      try {
        const response = await originalFetch(...args);
        if (!response.ok && response.status >= 400) {
          this.captureError({
            type: 'network_error',
            message: `Fetch failed: ${args[0]} - ${response.status} ${response.statusText}`,
            timestamp: Date.now(),
          });
        }
        return response;
      } catch (error) {
        this.captureError({
          type: 'network_error',
          message: `Fetch error: ${args[0]} - ${error instanceof Error ? error.message : String(error)}`,
          stack: error instanceof Error ? error.stack : undefined,
          timestamp: Date.now(),
        });
        throw error;
      }
    };
  }

  private interceptXHR() {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...args: unknown[]) {
      (this as XMLHttpRequest & { _url: string })._url = String(url);
      return originalOpen.call(this, method, url, ...(args as [boolean?, string?, string?]));
    };

    const self = this;
    XMLHttpRequest.prototype.send = function (...args: unknown[]) {
      this.addEventListener('error', function () {
        self.captureError({
          type: 'network_error',
          message: `XHR error: ${(this as XMLHttpRequest & { _url: string })._url}`,
          timestamp: Date.now(),
        });
      });

      this.addEventListener('load', function () {
        if (this.status >= 400) {
          self.captureError({
            type: 'network_error',
            message: `XHR failed: ${(this as XMLHttpRequest & { _url: string })._url} - ${this.status} ${this.statusText}`,
            timestamp: Date.now(),
          });
        }
      });

      return originalSend.apply(this, args as [Document | XMLHttpRequestBodyInit | null | undefined]);
    };
  }

  private captureError(errorData: Partial<BrowserError>) {
    const error: BrowserError = {
      type: errorData.type || 'unknown',
      message: errorData.message || 'No message',
      stack: errorData.stack,
      timestamp: errorData.timestamp || Date.now(),
      url: window.location.href,
      userAgent: navigator.userAgent,
      filename: errorData.filename,
      lineno: errorData.lineno,
      colno: errorData.colno,
      sessionId: this.sessionId,
    };

    // beforeSend hook
    if (this.config.beforeSend) {
      const modified = this.config.beforeSend(error);
      if (!modified) return; // User filtered it out
      Object.assign(error, modified);
    }

    this.errorQueue.push(error);

    this.log(`Captured ${error.type}: ${error.message}`);

    // Flush if queue is full
    if (this.errorQueue.length >= this.maxQueueSize) {
      this.flush();
    }
  }

  private startFlushInterval() {
    setInterval(() => {
      this.flush();
    }, this.flushInterval);
  }

  private async flush() {
    if (this.errorQueue.length === 0) return;

    const errors = [...this.errorQueue];
    this.errorQueue = [];

    try {
      const response = await fetch(`${this.config.serverUrl}/api/browser-errors`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-scanwarp-project-id': this.config.projectId,
        },
        body: JSON.stringify({ errors }),
      });

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }

      this.retryCount = 0;
      this.log(`Sent ${errors.length} errors`);
    } catch (error) {
      this.log(`Failed to send errors: ${error instanceof Error ? error.message : error}`);

      // Retry logic
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        this.errorQueue.unshift(...errors);
        setTimeout(() => this.flush(), 1000 * this.retryCount);
      }
    }
  }

  private generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private log(message: string) {
    if (this.config.debug) {
      console.log(`[ScanWarp] ${message}`);
    }
  }

  // Public API
  public trackError(message: string, metadata?: Record<string, unknown>) {
    this.captureError({
      type: 'custom',
      message,
      timestamp: Date.now(),
      stack: JSON.stringify(metadata),
    });
  }
}

// Auto-initialize from script tag
(function () {
  const scriptTag = document.currentScript as HTMLScriptElement | null;
  if (!scriptTag) return;

  const serverUrl = scriptTag.dataset.serverUrl || scriptTag.getAttribute('data-server-url');
  const projectId = scriptTag.dataset.projectId || scriptTag.getAttribute('data-project-id');
  const sampleRate = parseFloat(
    scriptTag.dataset.sampleRate || scriptTag.getAttribute('data-sample-rate') || '1.0'
  );
  const debug = scriptTag.dataset.debug === 'true' || scriptTag.getAttribute('data-debug') === 'true';

  if (!serverUrl || !projectId) {
    console.warn('[ScanWarp] Missing data-server-url or data-project-id attributes');
    return;
  }

  const instance = new ScanWarpBrowser({
    serverUrl,
    projectId,
    sampleRate,
    debug,
  });

  // Expose to window for custom tracking
  (window as Window & { ScanWarp?: ScanWarpBrowser }).ScanWarp = instance;
})();

export default ScanWarpBrowser;
