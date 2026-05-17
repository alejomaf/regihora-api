import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { UserRole } from '../../domain/enums';
import type { TenantAwareRequest } from '../../tenancy/types/current-tenant';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedRequest } from '../types/authenticated-principal';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles =
      this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (request.auth === undefined) {
      throw new UnauthorizedException('Authentication is required.');
    }

    const roles = this.getRolesForRequest(request);
    const hasRole = requiredRoles.some((role) => roles.includes(role));

    if (!hasRole) {
      throw new ForbiddenException('Insufficient role.');
    }

    return true;
  }

  private getRolesForRequest(request: AuthenticatedRequest): UserRole[] {
    const currentTenant = (request as TenantAwareRequest).tenant;

    if (currentTenant !== undefined) {
      return currentTenant.roles;
    }

    const tenantId = request.params.tenantId;

    if (typeof tenantId !== 'string' || tenantId.length === 0) {
      return request.auth?.roles ?? [];
    }

    return (
      request.auth?.memberships.find((membership) => membership.tenantId === tenantId)
        ?.roles ?? []
    );
  }
}
