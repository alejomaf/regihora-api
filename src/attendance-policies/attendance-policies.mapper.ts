import { AttendancePolicyEntity } from '../database/entities/attendance-policy.entity';
import { AttendancePolicyDto } from './dto/attendance-policy.dto';

export function toAttendancePolicyDto(
  policy: AttendancePolicyEntity,
): AttendancePolicyDto {
  return {
    allowedWorkplaceIds: policy.allowedWorkplaceIds,
    autoCheckout: {
      afterMinutes: policy.autoCheckoutAfterMinutes,
      enabled: policy.autoCheckoutEnabled,
    },
    createdAt: policy.createdAt.toISOString(),
    geolocationRequired: policy.geolocationRequired,
    id: policy.id,
    ipAllowlist: policy.ipAllowlist,
    mode: policy.mode,
    name: policy.name,
    status: policy.status,
    tenantId: policy.tenantId,
    updatedAt: policy.updatedAt.toISOString(),
  };
}
