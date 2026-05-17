import { DeviceStatus, DeviceType } from '../../domain/enums';

export type QrDeviceDto = {
  id: string;
  devicePublicId: string;
  tenantId: string;
  workplaceId: string;
  type: DeviceType;
  name: string;
  rotationSeconds: number;
  status: DeviceStatus;
  enrolledAt: string | null;
  lastHeartbeatAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type QrDeviceCreateRequestDto = {
  workplaceId?: unknown;
  type?: unknown;
  name?: unknown;
  rotationSeconds?: unknown;
};

export type QrDeviceUpdateRequestDto = {
  name?: unknown;
  rotationSeconds?: unknown;
  status?: unknown;
};

export type QrDeviceListQueryDto = {
  workplaceId?: unknown;
  status?: unknown;
};

export type QrDeviceListResponseDto = {
  data: QrDeviceDto[];
};

export type QrDeviceEnrollmentTokenDto = {
  qrDeviceId: string;
  enrollmentToken: string;
  issuedAt: string;
  expiresAt: string;
};

export type QrDeviceEnrollRequestDto = {
  enrollmentToken?: unknown;
};

export type QrDeviceEnrollmentDto = {
  device: QrDeviceDto;
  deviceToken: string;
  heartbeatIntervalSeconds: number;
};

export type QrDeviceHeartbeatDto = {
  tenantId: string;
  qrDeviceId: string;
  status: DeviceStatus;
  serverTime: string;
  lastHeartbeatAt: string;
  nextHeartbeatAfterSeconds: number;
};

export type QrChallengeDto = {
  devicePublicId: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
};
