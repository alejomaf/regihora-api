import { AttendancePolicyMode, ResourceStatus } from '../../domain/enums';

export type AttendancePolicyAutoCheckoutDto = {
  enabled: boolean;
  afterMinutes: number | null;
};

export type AttendancePolicyDto = {
  id: string;
  tenantId: string;
  name: string;
  mode: AttendancePolicyMode;
  geolocationRequired: boolean;
  ipAllowlist: string[];
  allowedWorkplaceIds: string[];
  autoCheckout: AttendancePolicyAutoCheckoutDto;
  status: ResourceStatus;
  createdAt: string;
  updatedAt: string;
};

export type AttendancePolicyCreateRequestDto = {
  name?: unknown;
  mode?: unknown;
  geolocationRequired?: unknown;
  ipAllowlist?: unknown;
  allowedWorkplaceIds?: unknown;
  autoCheckout?: unknown;
};

export type AttendancePolicyUpdateRequestDto = {
  name?: unknown;
  mode?: unknown;
  geolocationRequired?: unknown;
  ipAllowlist?: unknown;
  allowedWorkplaceIds?: unknown;
  autoCheckout?: unknown;
  status?: unknown;
};

export type AttendancePolicyListQueryDto = {
  limit?: unknown;
  cursor?: unknown;
  search?: unknown;
  status?: unknown;
  mode?: unknown;
};

export type AttendancePolicyListResponseDto = {
  data: AttendancePolicyDto[];
  pagination: {
    nextCursor: string | null;
  };
};
