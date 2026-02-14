/**
 * Page Health Checker
 * Tests frontend pages for common issues during dev mode
 */

export interface PageCheckResult {
  url: string;
  status: 'ok' | 'error' | 'blank' | 'slow';
  statusCode?: number;
  responseTime: number;
  hasContent: boolean;
  contentLength: number;
  issues: string[];
  checkedAt: number;
}

export interface PageHealthOptions {
  timeout?: number;
  slowThreshold?: number; // ms
  minContentLength?: number; // bytes
}

const DEFAULT_OPTIONS: Required<PageHealthOptions> = {
  timeout: 10000,
  slowThreshold: 3000,
  minContentLength: 100,
};

/**
 * Check a single page for health issues
 */
export async function checkPage(
  url: string,
  options: PageHealthOptions = {}
): Promise<PageCheckResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = Date.now();
  const issues: string[] = [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      method: 'GET',
      headers: {
        'User-Agent': 'ScanWarp-DevMode/1.0',
      },
    });

    clearTimeout(timeout);
    const responseTime = Date.now() - startTime;
    const statusCode = response.status;

    // Get response body
    const text = await response.text();
    const contentLength = text.length;
    const hasContent = contentLength >= opts.minContentLength;

    // Check for issues
    if (statusCode < 200 || statusCode >= 300) {
      issues.push(`HTTP ${statusCode}`);
    }

    if (!hasContent) {
      issues.push('Page appears blank (< 100 bytes)');
    }

    if (responseTime > opts.slowThreshold) {
      issues.push(`Slow response (${responseTime}ms)`);
    }

    // Check if response looks like HTML (not JSON error)
    if (statusCode === 200 && !text.trim().startsWith('<')) {
      issues.push('Response is not HTML (may be error JSON)');
    }

    // Check for basic HTML structure
    if (statusCode === 200 && hasContent) {
      if (!text.includes('<html') && !text.includes('<!DOCTYPE')) {
        issues.push('Missing DOCTYPE or <html> tag');
      }
      if (!text.includes('<title>')) {
        issues.push('Missing <title> tag');
      }
      if (!text.includes('<body')) {
        issues.push('Missing <body> tag');
      }
    }

    // Determine overall status
    let status: PageCheckResult['status'] = 'ok';
    if (issues.length > 0) {
      if (!hasContent) {
        status = 'blank';
      } else if (statusCode !== 200) {
        status = 'error';
      } else if (responseTime > opts.slowThreshold) {
        status = 'slow';
      } else {
        status = 'error';
      }
    }

    return {
      url,
      status,
      statusCode,
      responseTime,
      hasContent,
      contentLength,
      issues,
      checkedAt: Date.now(),
    };
  } catch (error) {
    clearTimeout(timeout);
    const responseTime = Date.now() - startTime;

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    issues.push(errorMessage);

    return {
      url,
      status: 'error',
      responseTime,
      hasContent: false,
      contentLength: 0,
      issues,
      checkedAt: Date.now(),
    };
  }
}

/**
 * Check all pages in a list
 */
export async function checkAllPages(
  pages: string[],
  baseUrl: string,
  options: PageHealthOptions = {}
): Promise<PageCheckResult[]> {
  const results: PageCheckResult[] = [];

  for (const page of pages) {
    const url = `${baseUrl}${page}`;
    const result = await checkPage(url, options);
    results.push(result);
  }

  return results;
}

/**
 * Format check results as a table for terminal display
 */
export function formatResultsTable(results: PageCheckResult[]): string {
  if (results.length === 0) {
    return 'No pages to check';
  }

  const rows = results.map((r) => {
    const statusIcon =
      r.status === 'ok' ? '✓' : r.status === 'blank' ? '⚠' : '✗';
    const statusText = r.status.toUpperCase().padEnd(6);
    const url = r.url.padEnd(30);
    const time = `${r.responseTime}ms`.padEnd(8);
    const code = r.statusCode ? `${r.statusCode}`.padEnd(4) : 'ERR ';

    return `  ${statusIcon} ${url} ${code} ${time} ${statusText}`;
  });

  const header = '  ' + 'URL'.padEnd(32) + 'Code'.padEnd(5) + 'Time'.padEnd(9) + 'Status';
  const separator = '  ' + '─'.repeat(60);

  return [separator, header, separator, ...rows, separator].join('\n');
}

/**
 * Get summary of results
 */
export function getResultsSummary(results: PageCheckResult[]): {
  total: number;
  ok: number;
  errors: number;
  blanks: number;
  slow: number;
} {
  return {
    total: results.length,
    ok: results.filter((r) => r.status === 'ok').length,
    errors: results.filter((r) => r.status === 'error').length,
    blanks: results.filter((r) => r.status === 'blank').length,
    slow: results.filter((r) => r.status === 'slow').length,
  };
}
