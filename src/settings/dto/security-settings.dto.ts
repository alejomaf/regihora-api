export type SecuritySettingsDto = {
  tenantId: string;
  sessionDeviceLimit: number | null;
};

export type SecuritySettingsUpdateRequestDto = {
  sessionDeviceLimit?: unknown;
};
