import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';

import { UserRole } from '../../domain/enums';
import type { TenantAwareRequest } from '../types/current-tenant';
import { TenantGuard } from './tenant.guard';

describe(TenantGuard.name, () => {
  it('attaches the current tenant from the required tenant header', () => {
    const request = makeRequest({
      headers: {
        'x-salidia-tenant-id': 'tenant-a',
      },
    });
    const guard = new TenantGuard();

    expect(guard.canActivate(makeContext(request))).toBe(true);
    expect(request.tenant).toEqual({
      employeeId: 'employee-a',
      roles: [UserRole.OWNER],
      tenantId: 'tenant-a',
      userId: 'user-1',
    });
  });

  it('allows tenantId path params for tenant resource routes', () => {
    const request = makeRequest({
      params: {
        tenantId: 'tenant-a',
      },
    });
    const guard = new TenantGuard();

    expect(guard.canActivate(makeContext(request))).toBe(true);
    expect(request.tenant?.tenantId).toBe('tenant-a');
  });

  it('rejects requests without a tenant_id', () => {
    const request = makeRequest();
    const guard = new TenantGuard();

    expect(() => guard.canActivate(makeContext(request))).toThrow(BadRequestException);
  });

  it('rejects unauthenticated tenant-scoped requests', () => {
    const request = makeRequest({
      auth: undefined,
      headers: {
        'x-salidia-tenant-id': 'tenant-a',
      },
    });
    const guard = new TenantGuard();

    expect(() => guard.canActivate(makeContext(request))).toThrow(
      UnauthorizedException,
    );
  });

  it('blocks cross-tenant access when the user is not a tenant member', () => {
    const request = makeRequest({
      headers: {
        'x-salidia-tenant-id': 'tenant-b',
      },
    });
    const guard = new TenantGuard();

    expect(() => guard.canActivate(makeContext(request))).toThrow(ForbiddenException);
    expect(request.tenant).toBeUndefined();
  });

  it('blocks cross-tenant requests with conflicting tenant identifiers', () => {
    const request = makeRequest({
      body: {
        tenant_id: 'tenant-b',
      },
      headers: {
        'x-salidia-tenant-id': 'tenant-a',
      },
    });
    const guard = new TenantGuard();

    expect(() => guard.canActivate(makeContext(request))).toThrow(ForbiddenException);
    expect(request.tenant).toBeUndefined();
  });
});

function makeContext(request: TenantAwareRequest): ExecutionContext {
  return {
    getClass: jest.fn(),
    getHandler: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

function makeRequest(
  overrides: Partial<TenantAwareRequest> = {},
): TenantAwareRequest {
  return {
    auth: {
      email: 'owner@example.com',
      memberships: [
        {
          employeeId: 'employee-a',
          roles: [UserRole.OWNER],
          tenantId: 'tenant-a',
        },
      ],
      roles: [UserRole.OWNER],
      sub: 'user-1',
    },
    body: {},
    headers: {},
    params: {},
    query: {},
    ...overrides,
  } as TenantAwareRequest;
}
