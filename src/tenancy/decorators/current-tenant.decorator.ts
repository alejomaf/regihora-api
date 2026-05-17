import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type {
  CurrentTenantContext,
  TenantAwareRequest,
} from '../types/current-tenant';

export const CurrentTenant = createParamDecorator(
  (
    data: keyof CurrentTenantContext | undefined,
    context: ExecutionContext,
  ): CurrentTenantContext | CurrentTenantContext[keyof CurrentTenantContext] | undefined => {
    const request = context.switchToHttp().getRequest<TenantAwareRequest>();

    if (data === undefined) {
      return request.tenant;
    }

    return request.tenant?.[data];
  },
);
