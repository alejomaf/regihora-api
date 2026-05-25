export type EmployeeInvitationAuthPreviewDto = {
  displayName: string;
  email: string;
  expiresAt: string;
  requiresPassword: boolean;
  tenantName: string;
};

export type AcceptEmployeeInvitationRequestDto = {
  token?: unknown;
  password?: unknown;
};
