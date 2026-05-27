import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { Request } from 'express';

const DEFAULT_IP_ALLOWLIST = ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '::1'];

@Injectable()
export class InternalAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expectedHash = process.env.INTERNAL_ADMIN_SERVICE_TOKEN_SHA256?.trim();
    const expectedToken = process.env.INTERNAL_ADMIN_SERVICE_TOKEN?.trim();

    if (!expectedHash && !expectedToken) {
      throw new ServiceUnavailableException('Internal admin service token is not configured.');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const clientIp = request.ip ?? request.socket.remoteAddress ?? '';
    const allowlist = parseIpAllowlist(
      process.env.INTERNAL_ADMIN_IP_ALLOWLIST,
    );

    if (!isIpAllowed(clientIp, allowlist)) {
      throw new ForbiddenException('Access from this IP is not allowed.');
    }

    const authorization = request.header('authorization') ?? '';
    const receivedToken = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : '';

    if (!isAcceptedToken(receivedToken, expectedHash, expectedToken)) {
      throw new UnauthorizedException('Invalid internal admin token.');
    }

    return true;
  }
}

function parseIpAllowlist(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim().length === 0) {
    return DEFAULT_IP_ALLOWLIST;
  }

  return raw.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

function isIpAllowed(clientIp: string, allowlist: string[]): boolean {
  const normalized = clientIp.startsWith('::ffff:') ? clientIp.slice(7) : clientIp;

  return allowlist.some((entry) => {
    const [ipPart, prefix] = entry.split('/');

    if (prefix === undefined) {
      const normalizedEntry = (ipPart ?? '').startsWith('::ffff:')
        ? (ipPart ?? '').slice(7)
        : (ipPart ?? '');

      return normalizedEntry === normalized;
    }

    const parsedPrefix = Number(prefix);

    if (
      !Number.isInteger(parsedPrefix) ||
      parsedPrefix < 0 ||
      parsedPrefix > 32 ||
      isIP(normalized) !== 4 ||
      isIP(ipPart ?? '') !== 4
    ) {
      return false;
    }

    const mask = parsedPrefix === 0 ? 0 : (0xffffffff << (32 - parsedPrefix)) >>> 0;

    return (ipToNumber(normalized) & mask) === (ipToNumber(ipPart ?? '') & mask);
  });
}

function ipToNumber(ip: string): number {
  return ip
    .split('.')
    .map(Number)
    .reduce((result, part) => ((result << 8) + part) >>> 0, 0);
}

function isAcceptedToken(token: string, expectedHash?: string, expectedToken?: string): boolean {
  if (expectedHash) {
    return isSameSecret(sha256(token), expectedHash);
  }

  return expectedToken !== undefined && isSameSecret(expectedToken, token);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isSameSecret(expected: string, received: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}
