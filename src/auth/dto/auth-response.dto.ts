import { UserRole } from '../../domain/enums';

export type AuthMembershipDto = {
  tenantId: string;
  tenantName: string;
  employeeId: string;
  roles: UserRole[];
};

export type AuthUserDto = {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
};

export type AuthUserSessionDto = {
  id: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  deviceLabel: string;
  current: boolean;
};

export type AuthSessionListResponseDto = {
  data: AuthUserSessionDto[];
};

export type AuthSecurityNoticeDto = {
  newDeviceLogin: boolean;
  activeSessionCount: number;
  message: string | null;
};

export type AuthResponseDto = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresAt: string;
  user: AuthUserDto;
  memberships: AuthMembershipDto[];
  currentSession: AuthUserSessionDto;
  securityNotice: AuthSecurityNoticeDto;
};
