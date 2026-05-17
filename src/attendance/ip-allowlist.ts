import { isIP } from 'node:net';

export function isIpAllowed(clientIp: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) {
    return true;
  }

  const normalizedClientIp = normalizeIp(clientIp);

  return allowlist.some((entry) => matchesAllowlistEntry(normalizedClientIp, entry));
}

function matchesAllowlistEntry(clientIp: string, entry: string): boolean {
  const [ipAddress, prefixLength] = entry.split('/');

  if (prefixLength === undefined) {
    return normalizeIp(entry) === clientIp;
  }

  if (isIP(clientIp) !== 4 || isIP(ipAddress ?? '') !== 4) {
    return false;
  }

  const parsedPrefix = Number(prefixLength);

  if (!Number.isInteger(parsedPrefix) || parsedPrefix < 0 || parsedPrefix > 32) {
    return false;
  }

  const mask =
    parsedPrefix === 0 ? 0 : (0xffffffff << (32 - parsedPrefix)) >>> 0;

  return (toIpv4Number(clientIp) & mask) === (toIpv4Number(ipAddress ?? '') & mask);
}

function normalizeIp(value: string): string {
  if (value.startsWith('::ffff:')) {
    return value.slice('::ffff:'.length);
  }

  return value;
}

function toIpv4Number(value: string): number {
  return value
    .split('.')
    .map((part) => Number(part))
    .reduce((result, part) => ((result << 8) + part) >>> 0, 0);
}
