import { AttendanceEventEntity } from '../database/entities/attendance-event.entity';
import { AttendancePunchDto } from './dto/attendance-punch.dto';

export function toAttendancePunchDto(
  event: AttendanceEventEntity,
): AttendancePunchDto {
  return {
    action: event.action,
    adjustmentId: event.adjustmentId,
    createdAt: event.createdAt.toISOString(),
    createdByUserId: event.createdByUserId,
    employeeId: event.employeeId,
    eventType: event.eventType,
    id: event.id,
    occurredAt: event.occurredAt.toISOString(),
    qrDeviceId: event.deviceId,
    source: event.source,
    tenantId: event.tenantId,
    validation: {
      gpsProvided: event.gpsProvided,
      gpsRequiredByPolicy: event.gpsRequiredByPolicy,
      qrChallengeId: event.qrChallengeId,
      qrChallengeValidated: event.qrChallengeId !== null,
    },
    workplaceId: event.workplaceId,
  };
}
