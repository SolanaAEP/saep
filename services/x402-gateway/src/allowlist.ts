import { isIP } from 'node:net';

const PRIVATE_CIDRS = [
  { prefix: '127.', bits: 8 },
  { prefix: '10.', bits: 8 },
  { prefix: '192.168.', bits: 16 },
  { prefix: '169.254.', bits: 16 },
  { prefix: '0.', bits: 8 },
];

function isPrivateIp(host: string): boolean {
  if (!isIP(host)) return false;
  for (const cidr of PRIVATE_CIDRS) {
    if (host.startsWith(cidr.prefix)) return true;
  }
  if (host.startsWith('172.')) {
    const second = parseInt(host.split('.')[1] ?? '', 10);
    if (second >= 16 && second <= 31) return true;
  }
  return host === '::1' || host === '::' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd');
}

export function isTargetAllowed(
  target: string,
  pattern: string,
  allowList: string[],
): boolean {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  // Explicit allowlist bypasses scheme/IP guards (operator opted in)
  if (allowList.some((h) => h === url.hostname)) return true;
  if (url.protocol !== 'https:') return false;
  if (isPrivateIp(url.hostname)) return false;
  return matchesPattern(url.hostname, pattern);
}

function matchesPattern(host: string, pattern: string): boolean {
  if (!pattern) return false;
  if (pattern === host) return true;
  if (pattern.startsWith('*.')) {
    const tail = pattern.slice(2);
    return host === tail || host.endsWith(`.${tail}`);
  }
  return false;
}
