import {
  AttendanceEventType,
  AttendanceSource,
  PunchAction,
} from '../../domain/enums';

export type AttendancePunchCreateRequestDto = {
  employeeId?: unknown;
  action?: unknown;
  source?: unknown;
  workplaceId?: unknown;
  qrChallengeToken?: unknown;
  qrChallenge?: unknown;
  locationEvidence?: unknown;
  deviceContext?: unknown;
};

export type TurnstilePunchCreateRequestDto = {
  scannedCode?: unknown;
  scanId?: unknown;
  deviceContext?: unknown;
};

export type LocationEvidenceDto = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: string;
};

export type DeviceContextDto = {
  timezone?: string;
  locale?: string;
  userAgent?: string;
};

export type PunchValidationDto = {
  gpsRequiredByPolicy: boolean;
  gpsProvided: boolean;
  qrChallengeValidated: boolean;
  qrChallengeId: string | null;
};

export type AttendancePunchDto = {
  id: string;
  tenantId: string;
  employeeId: string;
  eventType: AttendanceEventType;
  action: PunchAction;
  source: AttendanceSource;
  occurredAt: string;
  workplaceId: string | null;
  qrDeviceId: string | null;
  adjustmentId: string | null;
  createdAt: string;
  createdByUserId: string;
  validation: PunchValidationDto;
};
