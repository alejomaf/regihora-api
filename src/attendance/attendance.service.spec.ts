import { createHash } from 'node:crypto';

import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { AttendanceEventEntity } from '../database/entities/attendance-event.entity';
import { AttendancePolicyEntity } from '../database/entities/attendance-policy.entity';
import { DeviceEntity } from '../database/entities/device.entity';
import { EmployeeEntity } from '../database/entities/employee.entity';
import { TenantEntity } from '../database/entities/tenant.entity';
import { WorkplaceEntity } from '../database/entities/workplace.entity';
import {
  AttendanceEventType,
  AttendancePolicyMode,
  AttendanceSource,
  DeviceStatus,
  DeviceType,
  EmployeeStatus,
  PunchAction,
  ResourceStatus,
  UserRole,
  WorkMode,
} from '../domain/enums';
import {
  getQrChallengeId,
  signQrChallenge,
} from '../qr-devices/qr-challenge';
import type { QrChallengePayload } from '../qr-devices/qr-challenge';
import { CurrentTenantContext } from '../tenancy/types/current-tenant';
import { AttendanceService } from './attendance.service';

describe(AttendanceService.name, () => {
  it('creates an idempotent remote CLOCK_IN punch after policy, tenant, timezone, and source validation', async () => {
    const savedEvents: AttendanceEventEntity[] = [];
    const service = makeService({
      attendanceEventRepository: {
        create: (event: Partial<AttendanceEventEntity>) =>
          Object.assign(makeEvent(), event),
        findOne: jest.fn().mockResolvedValue(null),
        findOneBy: jest.fn().mockResolvedValue(null),
        save: jest.fn().mockImplementation((event: AttendanceEventEntity) => {
          event.id = 'event-created';
          event.createdAt = new Date('2026-01-01T08:00:00.000Z');
          savedEvents.push(event);
          return Promise.resolve(event);
        }),
      },
    });

    const response = await service.punch(
      {
        action: PunchAction.CLOCK_IN,
        employeeId: 'employee-a',
        locationEvidence: {
          accuracyMeters: 8,
          capturedAt: '2026-01-01T08:00:00.000Z',
          latitude: 40.4168,
          longitude: -3.7038,
        },
        source: AttendanceSource.REMOTE,
      },
      makePunchContext(),
    );

    expect(response).toEqual(
      expect.objectContaining({
        action: PunchAction.CLOCK_IN,
        employeeId: 'employee-a',
        id: 'event-created',
        source: AttendanceSource.REMOTE,
      }),
    );
    expect(savedEvents[0]).toEqual(
      expect.objectContaining({
        gpsProvided: true,
        gpsRequiredByPolicy: true,
        idempotencyKey: 'idem-1234',
        tenantId: 'tenant-a',
      }),
    );
  });

  it('returns the existing punch when the idempotency key is retried with the same payload', async () => {
    const existingEvent = makeEvent({
      action: PunchAction.CLOCK_IN,
      idempotencyKey: 'idem-1234',
      metadata: {
        idempotencyFingerprint: makePunchFingerprint({
          action: PunchAction.CLOCK_IN,
          deviceContext: {},
          employeeId: 'employee-a',
          locationEvidence: null,
          qrChallenge: null,
          qrChallengeTokenHash: null,
          source: AttendanceSource.REMOTE,
          workplaceId: null,
        }),
      },
      source: AttendanceSource.REMOTE,
    });
    const save = jest.fn();
    const service = makeService({
      attendanceEventRepository: {
        findOneBy: jest.fn().mockResolvedValue(existingEvent),
        save,
      },
    });

    const response = await service.punch(
      {
        action: PunchAction.CLOCK_IN,
        employeeId: 'employee-a',
        source: AttendanceSource.REMOTE,
      },
      makePunchContext(),
    );

    expect(response.id).toBe(existingEvent.id);
    expect(save).not.toHaveBeenCalled();
  });

  it.each([
    [PunchAction.CLOCK_IN, PunchAction.BREAK_START],
    [PunchAction.BREAK_START, PunchAction.BREAK_END],
    [PunchAction.BREAK_END, PunchAction.CLOCK_OUT],
  ])('allows %s after %s', async (lastAction, nextAction) => {
    const service = makeService({
      attendanceEventRepository: {
        create: (event: Partial<AttendanceEventEntity>) =>
          Object.assign(makeEvent(), event),
        findOne: jest.fn().mockResolvedValue(
          makeEvent({
            action: lastAction,
          }),
        ),
        findOneBy: jest.fn().mockResolvedValue(null),
      },
    });

    await expect(
      service.punch(
        {
          action: nextAction,
          employeeId: 'employee-a',
          locationEvidence: makeLocationEvidence(),
          source: AttendanceSource.REMOTE,
        },
        makePunchContext(),
      ),
    ).resolves.toEqual(expect.objectContaining({ action: nextAction }));
  });

  it('rejects invalid attendance session transitions', async () => {
    const service = makeService({
      attendanceEventRepository: {
        findOne: jest.fn().mockResolvedValue(
          makeEvent({
            action: PunchAction.CLOCK_IN,
          }),
        ),
        findOneBy: jest.fn().mockResolvedValue(null),
      },
    });

    await expect(
      service.punch(
        {
          action: PunchAction.CLOCK_IN,
          employeeId: 'employee-a',
          locationEvidence: makeLocationEvidence(),
          source: AttendanceSource.REMOTE,
        },
        makePunchContext(),
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('creates an onsite QR punch after validating signature, nonce, device, tenant, and policy', async () => {
    const deviceTokenHash = hashSecret('device-token-123456789012345678901234');
    const qrChallenge = makeQrChallenge(deviceTokenHash);
    const savedEvents: AttendanceEventEntity[] = [];
    const service = makeService({
      attendanceEventRepository: {
        create: (event: Partial<AttendanceEventEntity>) =>
          Object.assign(makeEvent(), event),
        findOne: jest.fn().mockResolvedValue(null),
        findOneBy: jest.fn().mockImplementation((where: Partial<AttendanceEventEntity>) => {
          if (where.qrChallengeId !== undefined) {
            return Promise.resolve(null);
          }

          return Promise.resolve(null);
        }),
        save: jest.fn().mockImplementation((event: AttendanceEventEntity) => {
          savedEvents.push(event);
          return Promise.resolve(event);
        }),
      },
      deviceRepository: {
        findOneBy: jest.fn().mockResolvedValue(
          makeDevice({
            deviceTokenHash,
            status: DeviceStatus.ACTIVE,
          }),
        ),
      },
      policyRepository: {
        findOneBy: jest.fn().mockResolvedValue(
          makePolicy({
            allowedWorkplaceIds: ['workplace-a'],
            geolocationRequired: false,
            ipAllowlist: [],
            mode: AttendancePolicyMode.ONSITE_QR,
          }),
        ),
      },
    });

    const response = await service.punch(
      {
        action: PunchAction.CLOCK_IN,
        employeeId: 'employee-a',
        qrChallenge,
        source: AttendanceSource.FIXED_DYNAMIC_QR,
        workplaceId: 'workplace-a',
      },
      makePunchContext(),
    );

    expect(response).toEqual(
      expect.objectContaining({
        qrDeviceId: 'device-a',
        source: AttendanceSource.FIXED_DYNAMIC_QR,
        workplaceId: 'workplace-a',
      }),
    );
    expect(response.validation).toEqual(
      expect.objectContaining({
        qrChallengeId: getQrChallengeId(qrChallenge),
        qrChallengeValidated: true,
      }),
    );
    expect(savedEvents[0]).toEqual(
      expect.objectContaining({
        deviceId: 'device-a',
        qrChallengeId: getQrChallengeId(qrChallenge),
      }),
    );
  });

  it('rejects reused QR challenge nonces', async () => {
    const deviceTokenHash = hashSecret('device-token-123456789012345678901234');
    const qrChallenge = makeQrChallenge(deviceTokenHash);
    const service = makeService({
      attendanceEventRepository: {
        findOne: jest.fn().mockResolvedValue(null),
        findOneBy: jest.fn().mockImplementation((where: Partial<AttendanceEventEntity>) => {
          if (where.qrChallengeId !== undefined) {
            return Promise.resolve(makeEvent({ qrChallengeId: where.qrChallengeId }));
          }

          return Promise.resolve(null);
        }),
      },
      deviceRepository: {
        findOneBy: jest.fn().mockResolvedValue(
          makeDevice({
            deviceTokenHash,
            status: DeviceStatus.ACTIVE,
          }),
        ),
      },
      policyRepository: {
        findOneBy: jest.fn().mockResolvedValue(
          makePolicy({
            allowedWorkplaceIds: ['workplace-a'],
            geolocationRequired: false,
            ipAllowlist: [],
            mode: AttendancePolicyMode.ONSITE_QR,
          }),
        ),
      },
    });

    await expect(
      service.punch(
        {
          action: PunchAction.CLOCK_IN,
          employeeId: 'employee-a',
          qrChallenge,
          source: AttendanceSource.FIXED_DYNAMIC_QR,
          workplaceId: 'workplace-a',
        },
        makePunchContext(),
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects fixed QR punches when the employee policy does not allow QR', async () => {
    const deviceTokenHash = hashSecret('device-token-123456789012345678901234');
    const service = makeService({
      deviceRepository: {
        findOneBy: jest.fn().mockResolvedValue(
          makeDevice({
            deviceTokenHash,
            status: DeviceStatus.ACTIVE,
          }),
        ),
      },
    });

    await expect(
      service.punch(
        {
          action: PunchAction.CLOCK_IN,
          employeeId: 'employee-a',
          qrChallenge: makeQrChallenge(deviceTokenHash),
          source: AttendanceSource.FIXED_DYNAMIC_QR,
          workplaceId: 'workplace-a',
        },
        makePunchContext(),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects source values that are not allowed by the active policy mode', async () => {
    const service = makeService({
      policyRepository: {
        findOneBy: jest.fn().mockResolvedValue(
          makePolicy({
            mode: AttendancePolicyMode.ONSITE_QR,
          }),
        ),
      },
    });

    await expect(
      service.punch(
        {
          action: PunchAction.CLOCK_IN,
          employeeId: 'employee-a',
          source: AttendanceSource.REMOTE,
        },
        makePunchContext(),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects punches for another employee session', async () => {
    const service = makeService();

    await expect(
      service.punch(
        {
          action: PunchAction.CLOCK_IN,
          employeeId: 'employee-b',
          source: AttendanceSource.REMOTE,
        },
        makePunchContext(),
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});

function makeService(overrides: {
  attendanceEventRepository?: Partial<Repository<AttendanceEventEntity>>;
  deviceRepository?: Partial<Repository<DeviceEntity>>;
  employeeRepository?: Partial<Repository<EmployeeEntity>>;
  policyRepository?: Partial<Repository<AttendancePolicyEntity>>;
  tenantRepository?: Partial<Repository<TenantEntity>>;
  workplaceRepository?: Partial<Repository<WorkplaceEntity>>;
} = {}): AttendanceService {
  return new AttendanceService(
    makeRepository(overrides.attendanceEventRepository),
    makeRepository(overrides.employeeRepository ?? {
      findOneBy: jest.fn().mockResolvedValue(makeEmployee()),
    }),
    makeRepository(overrides.policyRepository ?? {
      findOneBy: jest.fn().mockResolvedValue(makePolicy()),
    }),
    makeRepository(overrides.deviceRepository ?? {
      findOneBy: jest.fn().mockResolvedValue(makeDevice()),
    }),
    makeRepository(overrides.tenantRepository ?? {
      findOneBy: jest.fn().mockResolvedValue(makeTenant()),
    }),
    makeRepository(overrides.workplaceRepository ?? {
      findOneBy: jest.fn().mockResolvedValue(makeWorkplace()),
    }),
  );
}

function makeRepository<T>(overrides: Partial<Repository<T>> = {}): Repository<T> {
  return {
    create: (entity: Partial<T>) => entity,
    findOne: jest.fn().mockResolvedValue(null),
    findOneBy: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockImplementation((entity: T) => Promise.resolve(entity)),
    ...overrides,
  } as unknown as Repository<T>;
}

function makePunchFingerprint(payload: {
  action: PunchAction;
  deviceContext: Record<string, unknown>;
  employeeId: string;
  locationEvidence: Record<string, unknown> | null;
  qrChallenge: string | null;
  qrChallengeTokenHash: string | null;
  source: AttendanceSource;
  workplaceId: string | null;
}): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function makeQrChallenge(deviceTokenHash: string): QrChallengePayload {
  const unsignedChallenge = {
    devicePublicId: 'qrd_public123456789',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    issuedAt: new Date().toISOString(),
    nonce: 'nonce-123456789012345',
  };

  return {
    ...unsignedChallenge,
    signature: signQrChallenge(unsignedChallenge, deviceTokenHash),
  };
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function makeLocationEvidence(): {
  accuracyMeters: number;
  capturedAt: string;
  latitude: number;
  longitude: number;
} {
  return {
    accuracyMeters: 8,
    capturedAt: '2026-01-01T08:00:00.000Z',
    latitude: 40.4168,
    longitude: -3.7038,
  };
}

function makePunchContext(): {
  currentTenant: CurrentTenantContext;
  idempotencyKey: string;
  ipAddress: string;
  userAgent: string;
} {
  return {
    currentTenant: {
      employeeId: 'employee-a',
      roles: [UserRole.EMPLOYEE],
      tenantId: 'tenant-a',
      userId: 'user-a',
    },
    idempotencyKey: 'idem-1234',
    ipAddress: '203.0.113.10',
    userAgent: 'jest',
  };
}

function makeEvent(overrides: Partial<AttendanceEventEntity> = {}): AttendanceEventEntity {
  return Object.assign(new AttendanceEventEntity(), {
    action: PunchAction.CLOCK_OUT,
    adjustmentId: null,
    createdAt: new Date('2026-01-01T08:00:00.000Z'),
    createdByUserId: 'user-a',
    deviceId: null,
    employeeId: 'employee-a',
    eventType: AttendanceEventType.PUNCH,
    gpsProvided: false,
    gpsRequiredByPolicy: false,
    id: 'event-a',
    idempotencyKey: 'idem-old',
    metadata: {},
    occurredAt: new Date('2026-01-01T08:00:00.000Z'),
    qrChallengeId: null,
    source: AttendanceSource.REMOTE,
    tenantId: 'tenant-a',
    workplaceId: null,
    ...overrides,
  });
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

function makeEmployee(overrides: Partial<EmployeeEntity> = {}): EmployeeEntity {
  return Object.assign(new EmployeeEntity(), {
    attendancePolicyId: 'policy-a',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    departmentId: null,
    displayName: 'Ana',
    email: 'ana@example.com',
    id: 'employee-a',
    roles: [UserRole.EMPLOYEE],
    status: EmployeeStatus.ACTIVE,
    tenantId: 'tenant-a',
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    userId: 'user-a',
    workplaceId: null,
    ...overrides,
  });
}

function makePolicy(overrides: Partial<AttendancePolicyEntity> = {}): AttendancePolicyEntity {
  return Object.assign(new AttendancePolicyEntity(), {
    allowedWorkplaceIds: [],
    autoCheckoutAfterMinutes: null,
    autoCheckoutEnabled: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    geolocationRequired: true,
    id: 'policy-a',
    ipAllowlist: ['203.0.113.0/24'],
    mode: AttendancePolicyMode.REMOTE,
    name: 'Remote',
    status: ResourceStatus.ACTIVE,
    tenantId: 'tenant-a',
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}

function makeTenant(overrides: Partial<TenantEntity> = {}): TenantEntity {
  return Object.assign(new TenantEntity(), {
    id: 'tenant-a',
    locale: 'es-ES',
    timezone: 'Europe/Madrid',
    ...overrides,
  });
}
