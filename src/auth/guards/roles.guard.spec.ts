import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { UserRole } from '../../domain/enums';
import type { CurrentTenantContext } from '../../tenancy/types/current-tenant';
import type { JwtMembership } from '../types/authenticated-principal';
import { RolesGuard } from './roles.guard';

describe(RolesGuard.name, () => {
  it('allows a principal with any required role', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([UserRole.OWNER]),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const context = createContext([UserRole.OWNER]);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a principal without the required role', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([UserRole.HR_ADMIN]),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const context = createContext([UserRole.EMPLOYEE]);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('uses tenant-scoped roles when a tenantId route param is present', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([UserRole.OWNER]),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const context = createContext(
      [UserRole.OWNER, UserRole.EMPLOYEE],
      [
        {
          employeeId: 'employee-a',
          roles: [UserRole.OWNER],
          tenantId: 'tenant-a',
        },
        {
          employeeId: 'employee-b',
          roles: [UserRole.EMPLOYEE],
          tenantId: 'tenant-b',
        },
      ],
      'tenant-b',
    );

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('uses the resolved current tenant before flattened roles', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([UserRole.OWNER]),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const context = createContext([UserRole.OWNER], [], undefined, {
      employeeId: 'employee-b',
      roles: [UserRole.EMPLOYEE],
      tenantId: 'tenant-b',
      userId: 'user-id',
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});

function createContext(
  roles: UserRole[],
  memberships: JwtMembership[] = [],
  tenantId?: string,
  tenant?: CurrentTenantContext,
): ExecutionContext {
  return {
    getClass: jest.fn(),
    getHandler: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({
        auth: {
          email: 'owner@example.com',
          memberships,
          roles,
          sub: 'user-id',
        },
        params: {
          tenantId,
        },
        tenant,
      }),
    }),
  } as unknown as ExecutionContext;
}
