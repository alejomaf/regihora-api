import { ForbiddenException, ConflictException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { AdjustmentsService } from './adjustments.service';
import { AttendanceDailySummaryService } from './attendance-daily-summary.service';
import { AttendanceAdjustmentEntity } from '../database/entities/attendance-adjustment.entity';
import { AttendanceEventEntity } from '../database/entities/attendance-event.entity';
import { AuditLogEntity } from '../database/entities/audit-log.entity';
import { EmployeeEntity } from '../database/entities/employee.entity';
import { TenantEntity } from '../database/entities/tenant.entity';
import { WorkplaceEntity } from '../database/entities/workplace.entity';
import {
  AdjustmentStatus,
  AttendanceEventType,
  AttendanceSource,
  EmployeeStatus,
  PunchAction,
  ResourceStatus,
  UserRole,
  WorkMode,
} from '../domain/enums';
import type { CurrentTenantContext } from '../tenancy/types/current-tenant';

describe(AdjustmentsService.name, () => {
  it('lets an employee request an adjustment for their own employee record', async () => {
    const auditLogs: AuditLogEntity[] = [];
    const service = makeService({
      adjustmentRepository: {
        create: (adjustment: Partial<AttendanceAdjustmentEntity>) =>
          Object.assign(makeAdjustment(), adjustment),
        save: jest.fn().mockImplementation((adjustment: AttendanceAdjustmentEntity) =>
          Promise.resolve(adjustment),
        ),
      },
      auditLogRepository: {
        create: (auditLog: Partial<AuditLogEntity>) =>
          Object.assign(makeAuditLog(), auditLog),
        save: jest.fn().mockImplementation((auditLog: AuditLogEntity) => {
          auditLogs.push(auditLog);
          return Promise.resolve(auditLog);
        }),
      },
    });

    const response = await service.create(makeEmployeeContext(), {
      employeeId: 'employee-a',
      proposedPunch: {
        direction: PunchAction.CLOCK_IN,
        occurredAt: '2026-01-01T08:00:00.000Z',
        workplaceId: 'workplace-a',
      },
      reason: 'Forgot to clock in',
    });

    expect(response).toEqual(
      expect.objectContaining({
        employeeId: 'employee-a',
        status: AdjustmentStatus.PENDING,
      }),
    );
    expect(auditLogs).toEqual([
      expect.objectContaining({
        action: 'adjustment.requested',
        actorEmployeeId: 'employee-a',
        entityType: 'adjustment',
      }),
    ]);
  });

  it('rejects adjustment requests for another employee', async () => {
    const service = makeService();

    await expect(
      service.create(makeEmployeeContext(), {
        employeeId: 'employee-b',
        proposedPunch: {
          direction: PunchAction.CLOCK_IN,
          occurredAt: '2026-01-01T08:00:00.000Z',
        },
        reason: 'Not mine',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('approves a pending adjustment, creates a manual event, audits it, and recalculates the daily summary', async () => {
    const adjustment = makeAdjustment();
    const savedEvents: AttendanceEventEntity[] = [];
    const auditLogs: AuditLogEntity[] = [];
    const recalculateEmployeeDay = jest.fn().mockResolvedValue({});
    const service = makeService({
      adjustmentRepository: {
        findOneBy: jest.fn().mockResolvedValue(adjustment),
        save: jest.fn().mockImplementation((savedAdjustment: AttendanceAdjustmentEntity) =>
          Promise.resolve(savedAdjustment),
        ),
      },
      auditLogRepository: {
        create: (auditLog: Partial<AuditLogEntity>) =>
          Object.assign(makeAuditLog(), auditLog),
        save: jest.fn().mockImplementation((auditLog: AuditLogEntity) => {
          auditLogs.push(auditLog);
          return Promise.resolve(auditLog);
        }),
      },
      dailySummaryService: {
        recalculateEmployeeDay,
      },
      eventRepository: {
        create: (event: Partial<AttendanceEventEntity>) =>
          Object.assign(makeEvent(), event, { id: 'event-result' }),
        findOneBy: jest.fn().mockResolvedValue(null),
        save: jest.fn().mockImplementation((event: AttendanceEventEntity) => {
          savedEvents.push(event);
          return Promise.resolve(event);
        }),
      },
    });

    const response = await service.approve(makeManagerContext(), 'adjustment-a', {
      decisionReason: 'Evidence accepted',
    });

    expect(response).toEqual(
      expect.objectContaining({
        resultingPunchId: 'event-result',
        status: AdjustmentStatus.APPROVED,
      }),
    );
    expect(savedEvents[0]).toEqual(
      expect.objectContaining({
        action: PunchAction.CLOCK_IN,
        adjustmentId: 'adjustment-a',
        eventType: AttendanceEventType.ADJUSTMENT,
        source: AttendanceSource.MANUAL_ADJUSTMENT,
      }),
    );
    expect(auditLogs.map((auditLog) => auditLog.action)).toEqual([
      'adjustment.approved',
      'attendance_event.created_from_adjustment',
    ]);
    expect(recalculateEmployeeDay).toHaveBeenCalledWith(
      'tenant-a',
      'employee-a',
      '2026-01-01',
      'Europe/Madrid',
    );
  });

  it('rejects a pending adjustment without creating a resulting event', async () => {
    const eventSave = jest.fn();
    const service = makeService({
      adjustmentRepository: {
        findOneBy: jest.fn().mockResolvedValue(makeAdjustment()),
        save: jest.fn().mockImplementation((adjustment: AttendanceAdjustmentEntity) =>
          Promise.resolve(adjustment),
        ),
      },
      eventRepository: {
        save: eventSave,
      },
    });

    const response = await service.reject(makeManagerContext(), 'adjustment-a', {
      decisionReason: 'No supporting evidence',
    });

    expect(response).toEqual(
      expect.objectContaining({
        decisionReason: 'No supporting evidence',
        resultingPunchId: null,
        status: AdjustmentStatus.REJECTED,
      }),
    );
    expect(eventSave).not.toHaveBeenCalled();
  });

  it('does not decide an adjustment twice', async () => {
    const service = makeService({
      adjustmentRepository: {
        findOneBy: jest.fn().mockResolvedValue(
          makeAdjustment({
            status: AdjustmentStatus.APPROVED,
          }),
        ),
      },
    });

    await expect(
      service.approve(makeManagerContext(), 'adjustment-a', {}),
    ).rejects.toThrow(ConflictException);
  });
});

function makeService(overrides: {
  adjustmentRepository?: Partial<Repository<AttendanceAdjustmentEntity>>;
  auditLogRepository?: Partial<Repository<AuditLogEntity>>;
  dailySummaryService?: Partial<AttendanceDailySummaryService>;
  employeeRepository?: Partial<Repository<EmployeeEntity>>;
  eventRepository?: Partial<Repository<AttendanceEventEntity>>;
  tenantRepository?: Partial<Repository<TenantEntity>>;
  workplaceRepository?: Partial<Repository<WorkplaceEntity>>;
} = {}): AdjustmentsService {
  return new AdjustmentsService(
    makeRepository(overrides.adjustmentRepository ?? {
      findOneBy: jest.fn().mockResolvedValue(makeAdjustment()),
    }),
    makeRepository(overrides.eventRepository),
    makeRepository(overrides.auditLogRepository),
    makeRepository(overrides.employeeRepository ?? {
      findOneBy: jest.fn().mockResolvedValue(makeEmployee()),
    }),
    makeRepository(overrides.tenantRepository ?? {
      findOneBy: jest.fn().mockResolvedValue(makeTenant()),
    }),
    makeRepository(overrides.workplaceRepository ?? {
      findOneBy: jest.fn().mockResolvedValue(makeWorkplace()),
    }),
    {
      recalculateEmployeeDay: jest.fn().mockResolvedValue({}),
      ...overrides.dailySummaryService,
    } as unknown as AttendanceDailySummaryService,
  );
}

function makeRepository<T>(overrides: Partial<Repository<T>> = {}): Repository<T> {
  return {
    create: (entity: Partial<T>) => entity,
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    findOneBy: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockImplementation((entity: T) => Promise.resolve(entity)),
    ...overrides,
  } as unknown as Repository<T>;
}

function makeEmployeeContext(
  overrides: Partial<CurrentTenantContext> = {},
): CurrentTenantContext {
  return {
    employeeId: 'employee-a',
    roles: [UserRole.EMPLOYEE],
    tenantId: 'tenant-a',
    userId: 'user-a',
    ...overrides,
  };
}

function makeManagerContext(): CurrentTenantContext {
  return makeEmployeeContext({
    employeeId: 'manager-a',
    roles: [UserRole.MANAGER],
    userId: 'manager-user-a',
  });
}

function makeAdjustment(
  overrides: Partial<AttendanceAdjustmentEntity> = {},
): AttendanceAdjustmentEntity {
  return Object.assign(new AttendanceAdjustmentEntity(), {
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    decidedAt: null,
    decidedByUserId: null,
    decisionReason: null,
    employeeId: 'employee-a',
    id: 'adjustment-a',
    originalEventId: null,
    proposedAction: PunchAction.CLOCK_IN,
    proposedOccurredAt: new Date('2026-01-01T08:00:00.000Z'),
    proposedWorkplaceId: 'workplace-a',
    reason: 'Forgot to clock in',
    requestedAt: new Date('2026-01-01T10:00:00.000Z'),
    requestedByUserId: 'user-a',
    resultingEventId: null,
    status: AdjustmentStatus.PENDING,
    tenantId: 'tenant-a',
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}

function makeEvent(overrides: Partial<AttendanceEventEntity> = {}): AttendanceEventEntity {
  return Object.assign(new AttendanceEventEntity(), {
    action: PunchAction.CLOCK_OUT,
    adjustmentId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    createdByUserId: 'user-a',
    deviceId: null,
    employeeId: 'employee-a',
    eventType: AttendanceEventType.PUNCH,
    gpsProvided: false,
    gpsRequiredByPolicy: false,
    id: 'event-a',
    idempotencyKey: null,
    metadata: {},
    occurredAt: new Date('2026-01-01T17:00:00.000Z'),
    qrChallengeId: null,
    source: AttendanceSource.REMOTE,
    tenantId: 'tenant-a',
    workplaceId: null,
    ...overrides,
  });
}

function makeAuditLog(overrides: Partial<AuditLogEntity> = {}): AuditLogEntity {
  return Object.assign(new AuditLogEntity(), {
    action: 'audit',
    actorEmployeeId: 'employee-a',
    actorUserId: 'user-a',
    entityId: 'entity-a',
    entityType: 'entity',
    id: 'audit-a',
    metadata: {},
    occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    tenantId: 'tenant-a',
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

function makeTenant(overrides: Partial<TenantEntity> = {}): TenantEntity {
  return Object.assign(new TenantEntity(), {
    id: 'tenant-a',
    locale: 'es-ES',
    timezone: 'Europe/Madrid',
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
