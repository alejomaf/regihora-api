import type { AuthenticatedRequest } from '../../auth/types/authenticated-principal';
import type { UserRole } from '../../domain/enums';

export type CurrentTenantContext = {
  tenantId: string;
  employeeId: string;
  roles: UserRole[];
  userId: string;
};

export type TenantAwareRequest = AuthenticatedRequest & {
  tenant?: CurrentTenantContext;
};
