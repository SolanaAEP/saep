export function isTargetAllowed(
  target: string,
  pattern: string,
  allowList: string[],
): boolean {
  let host: string;
  try {
    host = new URL(target).hostname;
  } catch {
    return false;
  }
  if (allowList.some((h) => h === host)) return true;
  return matchesPattern(host, pattern);
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
