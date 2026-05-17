import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { EnvironmentVariables } from '../../config/environment.validation';
import { UserRole } from '../../domain/enums';
import {
  AuthenticatedPrincipal,
  AuthenticatedRequest,
  JwtMembership,
} from '../types/authenticated-principal';

const userRoleValues = new Set<string>(Object.values(UserRole));

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
    private readonly jwtService: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.getBearerToken(request);

    if (token === null) {
      throw new UnauthorizedException('Missing bearer token.');
    }

    try {
      const payload = await this.jwtService.verifyAsync<Record<string, unknown>>(token, {
        audience: this.configService.get('JWT_AUDIENCE', { infer: true }),
        issuer: this.configService.get('JWT_ISSUER', { infer: true }),
        secret: this.configService.get('JWT_ACCESS_TOKEN_SECRET', { infer: true }),
      });

      if (!isAuthenticatedPrincipal(payload)) {
        throw new UnauthorizedException('Invalid bearer token.');
      }

      request.auth = payload;

      return true;
    } catch {
      throw new UnauthorizedException('Invalid bearer token.');
    }
  }

  private getBearerToken(request: AuthenticatedRequest): string | null {
    const authorization = request.headers.authorization;

    if (!authorization?.startsWith('Bearer ')) {
      return null;
    }

    const token = authorization.slice('Bearer '.length).trim();

    return token.length > 0 ? token : null;
  }
}

function isAuthenticatedPrincipal(value: unknown): value is AuthenticatedPrincipal {
  return (
    isRecord(value) &&
    typeof value.sub === 'string' &&
    typeof value.email === 'string' &&
    Array.isArray(value.roles) &&
    value.roles.every(isUserRole) &&
    Array.isArray(value.memberships) &&
    value.memberships.every(isJwtMembership)
  );
}

function isJwtMembership(value: unknown): value is JwtMembership {
  return (
    isRecord(value) &&
    typeof value.tenantId === 'string' &&
    typeof value.employeeId === 'string' &&
    Array.isArray(value.roles) &&
    value.roles.every(isUserRole)
  );
}

function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && userRoleValues.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
