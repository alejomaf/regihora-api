import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import {
  AuthenticatedPrincipal,
  AuthenticatedRequest,
} from '../types/authenticated-principal';

export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedPrincipal | undefined => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    return request.auth;
  },
);

