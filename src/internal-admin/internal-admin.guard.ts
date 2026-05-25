import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Request } from 'express';

@Injectable()
export class InternalAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expectedHash = process.env.INTERNAL_ADMIN_SERVICE_TOKEN_SHA256?.trim();
    const expectedToken = process.env.INTERNAL_ADMIN_SERVICE_TOKEN?.trim();

    if (!expectedHash && !expectedToken) {
      throw new ServiceUnavailableException('Internal admin service token is not configured.');
    }

    const request = context.switchToHttp().getRequest<Request>();
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
