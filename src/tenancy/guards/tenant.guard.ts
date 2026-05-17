import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { resolveTenantId } from '../tenant-id.resolver';
import type { TenantAwareRequest } from '../types/current-tenant';

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<TenantAwareRequest>();

    if (request.auth === undefined) {
      throw new UnauthorizedException('Authentication is required.');
    }

    const tenantResolution = resolveTenantId(request);

    if (tenantResolution.status === 'missing') {
      throw new BadRequestException('tenant_id is required.');
    }

    if (tenantResolution.status === 'conflicting') {
      throw new ForbiddenException('Cross-tenant request is not allowed.');
    }

    const membership = request.auth.memberships.find(
      (candidate) => candidate.tenantId === tenantResolution.tenantId,
    );

    if (membership === undefined) {
      throw new ForbiddenException('Tenant access denied.');
    }

    request.tenant = {
      employeeId: membership.employeeId,
      roles: membership.roles,
      tenantId: membership.tenantId,
      userId: request.auth.sub,
    };

    return true;
  }
}
