import { URL } from 'url';
import net from 'net';

const PRIVATE_RANGES = [
  // IPv4 private/reserved ranges
  { start: '10.0.0.0', end: '10.255.255.255' },
  { start: '172.16.0.0', end: '172.31.255.255' },
  { start: '192.168.0.0', end: '192.168.255.255' },
  { start: '127.0.0.0', end: '127.255.255.255' },
  { start: '169.254.0.0', end: '169.254.255.255' },
  { start: '0.0.0.0', end: '0.255.255.255' },
];

function ipToLong(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isPrivateIP(ip: string): boolean {
  if (!net.isIPv4(ip)) {
    // Block IPv6 loopback
    if (ip === '::1' || ip === '::') return true;
    // Block IPv4-mapped IPv6 (::ffff:x.x.x.x)
    const v4Match = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (v4Match) return isPrivateIP(v4Match[1]);
    return false;
  }

  const long = ipToLong(ip);
  return PRIVATE_RANGES.some(
    (range) => long >= ipToLong(range.start) && long <= ipToLong(range.end)
  );
}

export interface URLValidationResult {
  valid: boolean;
  error?: string;
}

export function validateExternalURL(urlString: string): URLValidationResult {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  // Only allow http/https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: 'Only http and https URLs are allowed' };
  }

  // Block URLs with credentials
  if (parsed.username || parsed.password) {
    return { valid: false, error: 'URLs with credentials are not allowed' };
  }

  const hostname = parsed.hostname;

  // Block direct IP addresses in private ranges
  if (net.isIPv4(hostname) || net.isIPv6(hostname)) {
    if (isPrivateIP(hostname)) {
      return { valid: false, error: 'Private/internal IP addresses are not allowed' };
    }
  }

  // Block localhost variants
  const lowerHost = hostname.toLowerCase();
  if (
    lowerHost === 'localhost' ||
    lowerHost.endsWith('.localhost') ||
    lowerHost === '[::1]'
  ) {
    return { valid: false, error: 'Localhost URLs are not allowed' };
  }

  // Block common internal hostnames
  if (
    lowerHost.endsWith('.internal') ||
    lowerHost.endsWith('.local') ||
    lowerHost === 'metadata.google.internal' ||
    lowerHost === '169.254.169.254'
  ) {
    return { valid: false, error: 'Internal/metadata URLs are not allowed' };
  }

  return { valid: true };
}

export async function validateURLWithDNS(urlString: string): Promise<URLValidationResult> {
  const basicResult = validateExternalURL(urlString);
  if (!basicResult.valid) return basicResult;

  const { hostname } = new URL(urlString);

  // Skip DNS check for IPs (already validated above)
  if (net.isIPv4(hostname) || net.isIPv6(hostname)) {
    return { valid: true };
  }

  // Resolve DNS and check resolved IPs
  try {
    const dns = await import('dns');
    const { resolve4 } = dns.promises;
    const addresses = await resolve4(hostname);

    for (const addr of addresses) {
      if (isPrivateIP(addr)) {
        return {
          valid: false,
          error: `Hostname resolves to private IP (${addr})`,
        };
      }
    }
  } catch {
    // DNS resolution failure — allow through (fetch will fail naturally)
  }

  return { valid: true };
}
