import { randomUUID } from 'node:crypto';

import { ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { AttendanceEventEntity } from '../database/entities/attendance-event.entity';
import { AuditLogEntity } from '../database/entities/audit-log.entity';
import { EmployeeEntity } from '../database/entities/employee.entity';
import { TenantEntity } from '../database/entities/tenant.entity';
import { WorkplaceEntity } from '../database/entities/workplace.entity';
import {
  AttendanceEventType,
  AttendanceSource,
  EmployeeStatus,
  PunchAction,
  ReportFormat,
  TenantPlan,
  UserRole,
  WorkMode,
} from '../domain/enums';
import type { CurrentTenantContext } from '../tenancy/types/current-tenant';
import { ReportsService } from './reports.service';

describe(ReportsService.name, () => {
  it('exports a legal CSV report by employee, workplace, and period, and audits the export', async () => {
    const auditLogs: AuditLogEntity[] = [];
    const service = makeService({
      auditLogRepository: {
        create: (auditLog: Partial<AuditLogEntity>) =>
          Object.assign(new AuditLogEntity(), auditLog),
        save: jest.fn().mockImplementation((auditLog: AuditLogEntity) => {
          auditLogs.push(auditLog);
          return Promise.resolve(auditLog);
        }),
      },
      employeeRepository: {
        find: jest.fn().mockResolvedValue([makeEmployee()]),
      },
      eventRepository: {
        find: jest.fn().mockResolvedValue(makeWorkedDayEvents()),
      },
      workplaceRepository: {
        find: jest.fn().mockResolvedValue([makeWorkplace()]),
        findOneBy: jest.fn().mockResolvedValue(makeWorkplace()),
      },
    });

    const file = await service.exportLegalAttendanceReport(makeManagerContext(), {
      employeeId: 'employee-a',
      format: ReportFormat.CSV,
      from: '2026-01-01',
      to: '2026-01-01',
      workplaceId: 'workplace-a',
    });

    const csv = file.body.toString('utf8');

    expect(file.contentType).toContain('text/csv');
    expect(file.filename).toBe('regihora-registro-horario-2026-01-01_2026-01-01.csv');
    expect(csv).toContain('"Ana Ruiz"');
    expect(csv).toContain('"510"');
    expect(csv).toContain('"30"');
    expect(csv).toContain('"CON_AJUSTES"');
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]).toEqual(
      expect.objectContaining({
        action: 'attendance_report.exported',
        actorEmployeeId: 'manager-a',
        entityType: 'attendance_report',
      }),
    );
    expect(auditLogs[0]?.metadata.format).toBe(ReportFormat.CSV);
    expect(auditLogs[0]?.metadata.rowCount).toBe(1);
    expect(auditLogs[0]?.metadata.workplaceId).toBe('workplace-a');
  });

  it('prevents employees from exporting another employee legal report', async () => {
    const service = makeService();

    await expect(
      service.exportLegalAttendanceReport(makeEmployeeContext(), {
        employeeId: 'employee-b',
        from: '2026-01-01',
        to: '2026-01-01',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it.each([
    [ReportFormat.XLSX, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'PK'],
    [ReportFormat.PDF, 'application/pdf', '%PDF'],
  ])('exports %s files for legal reports', async (format, contentType, signature) => {
    const service = makeService({
      employeeRepository: {
        find: jest.fn().mockResolvedValue([makeEmployee()]),
      },
      workplaceRepository: {
        find: jest.fn().mockResolvedValue([makeWorkplace()]),
      },
    });

    const file = await service.exportLegalAttendanceReport(makeManagerContext(), {
      format,
      from: '2026-01-01',
      to: '2026-01-01',
    });

    expect(file.contentType).toBe(contentType);
    expect(file.body.subarray(0, signature.length).toString()).toBe(signature);
  });
});

function makeService(overrides: {
  auditLogRepository?: Partial<Repository<AuditLogEntity>>;
  employeeRepository?: Partial<Repository<EmployeeEntity>>;
  eventRepository?: Partial<Repository<AttendanceEventEntity>>;
  tenantRepository?: Partial<Repository<TenantEntity>>;
  workplaceRepository?: Partial<Repository<WorkplaceEntity>>;
} = {}): ReportsService {
  return new ReportsService(
    makeRepository(overrides.eventRepository),
    makeRepository(
      overrides.auditLogRepository ?? {
        create: (auditLog: Partial<AuditLogEntity>) =>
          Object.assign(new AuditLogEntity(), auditLog),
      },
    ),
    makeRepository(
      overrides.employeeRepository ?? {
        find: jest.fn().mockResolvedValue([makeEmployee()]),
      },
    ),
    makeRepository(
      overrides.tenantRepository ?? {
        findOneBy: jest.fn().mockResolvedValue(makeTenant()),
      },
    ),
    makeRepository(overrides.workplaceRepository),
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

function makeManagerContext(): CurrentTenantContext {
  return {
    employeeId: 'manager-a',
    roles: [UserRole.MANAGER],
    tenantId: 'tenant-a',
    userId: 'manager-user-a',
  };
}

function makeEmployeeContext(): CurrentTenantContext {
  return {
    employeeId: 'employee-a',
    roles: [UserRole.EMPLOYEE],
    tenantId: 'tenant-a',
    userId: 'user-a',
  };
}

function makeTenant(): TenantEntity {
  return Object.assign(new TenantEntity(), {
    id: 'tenant-a',
    legalName: 'Regihora Demo SL',
    locale: 'es-ES',
    plan: TenantPlan.PRO,
    taxId: 'B12345678',
    timezone: 'Europe/Madrid',
  });
}

function makeEmployee(): EmployeeEntity {
  return Object.assign(new EmployeeEntity(), {
    displayName: 'Ana Ruiz',
    email: 'ana@example.com',
    id: 'employee-a',
    status: EmployeeStatus.ACTIVE,
    tenantId: 'tenant-a',
    workplaceId: 'workplace-a',
  });
}

function makeWorkplace(): WorkplaceEntity {
  return Object.assign(new WorkplaceEntity(), {
    id: 'workplace-a',
    mode: WorkMode.IN_PERSON,
    name: 'Madrid Centro',
    tenantId: 'tenant-a',
    timezone: 'Europe/Madrid',
  });
}

function makeWorkedDayEvents(): AttendanceEventEntity[] {
  return [
    makeEvent({
      action: PunchAction.CLOCK_IN,
      occurredAt: new Date('2026-01-01T08:00:00.000Z'),
    }),
    makeEvent({
      action: PunchAction.BREAK_START,
      occurredAt: new Date('2026-01-01T12:00:00.000Z'),
    }),
    makeEvent({
      action: PunchAction.BREAK_END,
      eventType: AttendanceEventType.ADJUSTMENT,
      occurredAt: new Date('2026-01-01T12:30:00.000Z'),
      source: AttendanceSource.MANUAL_ADJUSTMENT,
    }),
    makeEvent({
      action: PunchAction.CLOCK_OUT,
      occurredAt: new Date('2026-01-01T17:00:00.000Z'),
    }),
  ];
}

function makeEvent(
  overrides: Partial<AttendanceEventEntity> = {},
): AttendanceEventEntity {
  return Object.assign(new AttendanceEventEntity(), {
    action: PunchAction.CLOCK_IN,
    createdAt: new Date('2026-01-01T08:00:00.000Z'),
    createdByUserId: 'user-a',
    employeeId: 'employee-a',
    eventType: AttendanceEventType.PUNCH,
    gpsProvided: false,
    gpsRequiredByPolicy: false,
    id: randomUUID(),
    metadata: {
      localDate: '2026-01-01',
      timezone: 'Europe/Madrid',
    },
    occurredAt: new Date('2026-01-01T08:00:00.000Z'),
    qrChallengeId: null,
    source: AttendanceSource.REMOTE,
    tenantId: 'tenant-a',
    workplaceId: 'workplace-a',
    ...overrides,
  });
}
