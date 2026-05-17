import {
  AdjustmentStatus,
  AttendanceEventType,
  PunchAction,
} from '../../domain/enums';

export type AdjustmentProposedPunchDto = {
  direction: PunchAction;
  occurredAt: string;
  workplaceId: string | null;
};

export type AttendanceAdjustmentDto = {
  id: string;
  tenantId: string;
  employeeId: string;
  eventType: AttendanceEventType;
  status: AdjustmentStatus;
  requestedByUserId: string;
  requestedAt: string;
  reason: string;
  originalPunchId: string | null;
  proposedPunch: AdjustmentProposedPunchDto;
  decidedByUserId: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  resultingPunchId: string | null;
};

export type AttendanceAdjustmentCreateRequestDto = {
  employeeId?: unknown;
  originalPunchId?: unknown;
  reason?: unknown;
  proposedPunch?: unknown;
};

export type AdjustmentDecisionRequestDto = {
  decisionReason?: unknown;
};

export type AttendanceAdjustmentListQueryDto = {
  employeeId?: unknown;
  status?: unknown;
  limit?: unknown;
  cursor?: unknown;
};

export type AttendanceAdjustmentListResponseDto = {
  data: AttendanceAdjustmentDto[];
  pagination: {
    nextCursor: string | null;
  };
};
