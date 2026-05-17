import { DeviceEntity } from '../database/entities/device.entity';
import { QrDeviceDto } from './dto/qr-device.dto';

export function toQrDeviceDto(device: DeviceEntity): QrDeviceDto {
  return {
    createdAt: device.createdAt.toISOString(),
    devicePublicId: device.publicId,
    enrolledAt: device.enrolledAt?.toISOString() ?? null,
    id: device.id,
    lastHeartbeatAt: device.lastHeartbeatAt?.toISOString() ?? null,
    name: device.name,
    revokedAt: device.revokedAt?.toISOString() ?? null,
    rotationSeconds: device.rotationSeconds,
    status: device.status,
    tenantId: device.tenantId,
    type: device.type,
    updatedAt: device.updatedAt.toISOString(),
    workplaceId: device.workplaceId,
  };
}
