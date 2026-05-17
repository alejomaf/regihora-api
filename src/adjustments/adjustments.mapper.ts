import { AttendanceAdjustmentEntity } from '../database/entities/attendance-adjustment.entity';
import { AttendanceEventType } from '../domain/enums';
import { AttendanceAdjustmentDto } from './dto/adjustment.dto';

export function toAttendanceAdjustmentDto(
  adjustment: AttendanceAdjustmentEntity,
): AttendanceAdjustmentDto {
  return {
    decidedAt: adjustment.decidedAt?.toISOString() ?? null,
    decidedByUserId: adjustment.decidedByUserId,
    decisionReason: adjustment.decisionReason,
    employeeId: adjustment.employeeId,
    eventType: AttendanceEventType.ADJUSTMENT,
    id: adjustment.id,
    originalPunchId: adjustment.originalEventId,
    proposedPunch: {
      direction: adjustment.proposedAction,
      occurredAt: adjustment.proposedOccurredAt.toISOString(),
      workplaceId: adjustment.proposedWorkplaceId,
    },
    reason: adjustment.reason,
    requestedAt: adjustment.requestedAt.toISOString(),
    requestedByUserId: adjustment.requestedByUserId,
    resultingPunchId: adjustment.resultingEventId,
    status: adjustment.status,
    tenantId: adjustment.tenantId,
  };
}
