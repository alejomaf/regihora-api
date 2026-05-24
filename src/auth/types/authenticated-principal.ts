import { Request } from 'express';

import { UserRole } from '../../domain/enums';

export type JwtMembership = {
  tenantId: string;
  tenantName?: string;
  employeeId: string;
  roles: UserRole[];
};

export type AuthenticatedPrincipal = {
  sub: string;
  email: string;
  roles: UserRole[];
  memberships: JwtMembership[];
  sessionId?: string;
};

export type AuthenticatedRequest = Request & {
  auth?: AuthenticatedPrincipal;
};

export type RequestAuthContext = {
  ipAddress: string | null;
  userAgent: string | null;
};
