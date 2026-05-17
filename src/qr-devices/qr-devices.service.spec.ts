import { createHash } from 'node:crypto';

import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { DeviceEntity } from '../database/entities/device.entity';
import { WorkplaceEntity } from '../database/entities/workplace.entity';
import { DeviceStatus, DeviceType, ResourceStatus, WorkMode } from '../domain/enums';
import { isQrChallengeSignatureValid } from './qr-challenge';
import { QrDevicesService } from './qr-devices.service';

describe(QrDevicesService.name, () => {
  it('creates an inactive QR device for an active workplace', async () => {
    const savedDevices: DeviceEntity[] = [];
    const service = makeService({
      deviceRepository: {
        create: (device: Partial<DeviceEntity>) =>
          Object.assign(makeDevice(), device),
        findOneBy: jest.fn().mockResolvedValue(null),
        save: jest.fn().mockImplementation((device: DeviceEntity) => {
          savedDevices.push(device);
          return Promise.resolve(device);
        }),
      },
    });

    const response = await service.create('tenant-a', {
      name: 'Recepcion',
      rotationSeconds: 30,
      workplaceId: 'workplace-a',
    });

    expect(response).toEqual(
      expect.objectContaining({
        name: 'Recepcion',
        rotationSeconds: 30,
        status: DeviceStatus.INACTIVE,
        type: DeviceType.FIXED_DYNAMIC_QR,
      }),
    );
    expect(response.devicePublicId).toMatch(/^qrd_/);
    expect(savedDevices[0]).toEqual(
      expect.objectContaining({
        deviceTokenHash: null,
        enrollmentTokenHash: null,
        tenantId: 'tenant-a',
        workplaceId: 'workplace-a',
      }),
    );
    expect(savedDevices[0]?.publicId).toMatch(/^qrd_/);
  });

  it('creates a one-time enrollment token and stores only its hash', async () => {
    const device = makeDevice({ status: DeviceStatus.INACTIVE });
    const service = makeService({
      deviceRepository: {
        findOneBy: jest.fn().mockResolvedValue(device),
        save: jest.fn().mockImplementation((savedDevice: DeviceEntity) =>
          Promise.resolve(savedDevice),
        ),
      },
    });

    const response = await service.createEnrollmentToken('tenant-a', 'device-a');

    expect(response.qrDeviceId).toBe('device-a');
    expect(response.enrollmentToken).toHaveLength(43);
    expect(device.enrollmentTokenHash).toBe(hashSecret(response.enrollmentToken));
    expect(device.enrollmentTokenExpiresAt).toBeInstanceOf(Date);
  });

  it('enrolls a device with a valid enrollment token and returns a device token once', async () => {
    const enrollmentToken = 'enrollment-token-12345678901234567890';
    const device = makeDevice({
      enrollmentTokenExpiresAt: new Date(Date.now() + 60_000),
      enrollmentTokenHash: hashSecret(enrollmentToken),
      status: DeviceStatus.INACTIVE,
    });
    const service = makeService({
      deviceRepository: {
        findOneBy: jest.fn().mockResolvedValue(device),
        save: jest.fn().mockImplementation((savedDevice: DeviceEntity) =>
          Promise.resolve(savedDevice),
        ),
      },
    });

    const response = await service.enroll({ enrollmentToken });

    expect(response.device.status).toBe(DeviceStatus.ACTIVE);
    expect(response.deviceToken).toHaveLength(64);
    expect(response.heartbeatIntervalSeconds).toBe(60);
    expect(device.deviceTokenHash).toBe(hashSecret(response.deviceToken));
    expect(device.enrollmentTokenHash).toBeNull();
    expect(device.enrollmentTokenExpiresAt).toBeNull();
    expect(device.enrolledAt).toBeInstanceOf(Date);
    expect(device.lastHeartbeatAt).toBeInstanceOf(Date);
  });

  it('rejects expired enrollment tokens', async () => {
    const enrollmentToken = 'enrollment-token-12345678901234567890';
    const service = makeService({
      deviceRepository: {
        findOneBy: jest.fn().mockResolvedValue(
          makeDevice({
            enrollmentTokenExpiresAt: new Date(Date.now() - 60_000),
            enrollmentTokenHash: hashSecret(enrollmentToken),
            status: DeviceStatus.INACTIVE,
          }),
        ),
      },
    });

    await expect(service.enroll({ enrollmentToken })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('accepts heartbeat only for an active device with a valid device token', async () => {
    const deviceToken = 'device-token-123456789012345678901234';
    const device = makeDevice({
      deviceTokenHash: hashSecret(deviceToken),
      status: DeviceStatus.ACTIVE,
    });
    const service = makeService({
      deviceRepository: {
        findOneBy: jest.fn().mockResolvedValue(device),
        save: jest.fn().mockImplementation((savedDevice: DeviceEntity) =>
          Promise.resolve(savedDevice),
        ),
      },
    });

    const response = await service.heartbeat('device-a', deviceToken);

    expect(response).toEqual(
      expect.objectContaining({
        nextHeartbeatAfterSeconds: 60,
        qrDeviceId: 'device-a',
        status: DeviceStatus.ACTIVE,
        tenantId: 'tenant-a',
      }),
    );
    expect(device.lastHeartbeatAt).toBeInstanceOf(Date);
  });

  it('creates a signed dynamic QR challenge for an active device token', async () => {
    const deviceToken = 'device-token-123456789012345678901234';
    const device = makeDevice({
      deviceTokenHash: hashSecret(deviceToken),
      status: DeviceStatus.ACTIVE,
    });
    const service = makeService({
      deviceRepository: {
        findOneBy: jest.fn().mockResolvedValue(device),
      },
    });

    const challenge = await service.createChallenge('device-a', deviceToken);

    expect(challenge).toEqual(
      expect.objectContaining({
        devicePublicId: 'qrd_public123456789',
      }),
    );
    expect(challenge.nonce).toEqual(expect.any(String));
    expect(challenge.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(isQrChallengeSignatureValid(challenge, device.deviceTokenHash ?? '')).toBe(
      true,
    );
    expect(new Date(challenge.expiresAt).getTime()).toBeGreaterThan(
      new Date(challenge.issuedAt).getTime(),
    );
  });

  it('revokes a device and invalidates enrollment and device tokens', async () => {
    const device = makeDevice({
      deviceTokenHash: hashSecret('device-token-123456789012345678901234'),
      enrollmentTokenExpiresAt: new Date(Date.now() + 60_000),
      enrollmentTokenHash: hashSecret('enrollment-token-12345678901234567890'),
      status: DeviceStatus.ACTIVE,
    });
    const service = makeService({
      deviceRepository: {
        findOneBy: jest.fn().mockResolvedValue(device),
        save: jest.fn().mockImplementation((savedDevice: DeviceEntity) =>
          Promise.resolve(savedDevice),
        ),
      },
    });

    const response = await service.revoke('tenant-a', 'device-a');

    expect(response.status).toBe(DeviceStatus.REVOKED);
    expect(device.deviceTokenHash).toBeNull();
    expect(device.enrollmentTokenHash).toBeNull();
    expect(device.enrollmentTokenExpiresAt).toBeNull();
    expect(device.revokedAt).toBeInstanceOf(Date);
  });

  it('does not activate an unenrolled device through a status update', async () => {
    const service = makeService({
      deviceRepository: {
        findOneBy: jest.fn().mockResolvedValue(
          makeDevice({
            deviceTokenHash: null,
            status: DeviceStatus.INACTIVE,
          }),
        ),
      },
    });

    await expect(
      service.update('tenant-a', 'device-a', { status: DeviceStatus.ACTIVE }),
    ).rejects.toThrow(ConflictException);
  });
});

function makeService(overrides: {
  deviceRepository?: Partial<Repository<DeviceEntity>>;
  workplaceRepository?: Partial<Repository<WorkplaceEntity>>;
} = {}): QrDevicesService {
  return new QrDevicesService(
    makeRepository(overrides.deviceRepository ?? {
      findOneBy: jest.fn().mockResolvedValue(makeDevice()),
    }),
    makeRepository(overrides.workplaceRepository ?? {
      findOneBy: jest.fn().mockResolvedValue(makeWorkplace()),
    }),
  );
}

function makeRepository<T>(overrides: Partial<Repository<T>> = {}): Repository<T> {
  return {
    create: (entity: Partial<T>) => entity,
    find: jest.fn().mockResolvedValue([]),
    findOneBy: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockImplementation((entity: T) => Promise.resolve(entity)),
    ...overrides,
  } as unknown as Repository<T>;
}

function makeDevice(overrides: Partial<DeviceEntity> = {}): DeviceEntity {
  return Object.assign(new DeviceEntity(), {
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    deviceTokenHash: null,
    enrolledAt: null,
    enrollmentTokenExpiresAt: null,
    enrollmentTokenHash: null,
    id: 'device-a',
    lastHeartbeatAt: null,
    name: 'Recepcion',
    publicId: 'qrd_public123456789',
    revokedAt: null,
    rotationSeconds: 60,
    status: DeviceStatus.INACTIVE,
    tenantId: 'tenant-a',
    type: DeviceType.FIXED_DYNAMIC_QR,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    workplaceId: 'workplace-a',
    ...overrides,
  });
}

function makeWorkplace(overrides: Partial<WorkplaceEntity> = {}): WorkplaceEntity {
  return Object.assign(new WorkplaceEntity(), {
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    id: 'workplace-a',
    mode: WorkMode.IN_PERSON,
    name: 'Oficina Madrid',
    status: ResourceStatus.ACTIVE,
    tenantId: 'tenant-a',
    timezone: 'Europe/Madrid',
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}
