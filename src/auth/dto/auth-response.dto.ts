import { UserRole } from '../../domain/enums';

export type AuthMembershipDto = {
  tenantId: string;
  employeeId: string;
  roles: UserRole[];
};

export type AuthUserDto = {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
};

export type AuthResponseDto = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresAt: string;
  user: AuthUserDto;
  memberships: AuthMembershipDto[];
};
