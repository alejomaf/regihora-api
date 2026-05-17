import { Repository } from 'typeorm';

import { AttendanceDailySummaryService } from './attendance-daily-summary.service';
import { AttendanceDailySummaryEntity } from '../database/entities/attendance-daily-summary.entity';
import { AttendanceEventEntity } from '../database/entities/attendance-event.entity';
import {
  AttendanceEventType,
  AttendanceSource,
  PunchAction,
} from '../domain/enums';

describe(AttendanceDailySummaryService.name, () => {
  it('recalculates worked and break minutes from immutable events', async () => {
    const savedSummaries: AttendanceDailySummaryEntity[] = [];
    const service = new AttendanceDailySummaryService(
      makeRepository<AttendanceDailySummaryEntity>({
        create: (summary: Partial<AttendanceDailySummaryEntity>) =>
          Object.assign(new AttendanceDailySummaryEntity(), summary),
        findOneBy: jest.fn().mockResolvedValue(null),
        save: jest.fn().mockImplementation((summary: AttendanceDailySummaryEntity) => {
          savedSummaries.push(summary);
          return Promise.resolve(summary);
        }),
      }),
      makeRepository<AttendanceEventEntity>({
        find: jest.fn().mockResolvedValue([
          makeEvent(PunchAction.CLOCK_IN, '2026-01-01T08:00:00.000Z'),
          makeEvent(PunchAction.BREAK_START, '2026-01-01T12:00:00.000Z'),
          makeEvent(PunchAction.BREAK_END, '2026-01-01T12:30:00.000Z'),
          makeEvent(PunchAction.CLOCK_OUT, '2026-01-01T17:00:00.000Z'),
        ]),
      }),
    );

    const response = await service.recalculateEmployeeDay(
      'tenant-a',
      'employee-a',
      '2026-01-01',
      'Europe/Madrid',
    );

    expect(response).toEqual(
      expect.objectContaining({
        breakMinutes: 30,
        eventCount: 4,
        firstClockInAt: new Date('2026-01-01T08:00:00.000Z'),
        lastClockOutAt: new Date('2026-01-01T17:00:00.000Z'),
        openBreak: false,
        openSession: false,
        workedMinutes: 510,
      }),
    );
    expect(savedSummaries).toHaveLength(1);
  });
});

function makeRepository<T>(overrides: Partial<Repository<T>> = {}): Repository<T> {
  return {
    create: (entity: Partial<T>) => entity,
    find: jest.fn().mockResolvedValue([]),
    findOneBy: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockImplementation((entity: T) => Promise.resolve(entity)),
    ...overrides,
  } as unknown as Repository<T>;
}

function makeEvent(action: PunchAction, occurredAt: string): AttendanceEventEntity {
  return Object.assign(new AttendanceEventEntity(), {
    action,
    adjustmentId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    createdByUserId: 'user-a',
    deviceId: null,
    employeeId: 'employee-a',
    eventType: AttendanceEventType.PUNCH,
    gpsProvided: false,
    gpsRequiredByPolicy: false,
    id: `${action}-${occurredAt}`,
    idempotencyKey: null,
    metadata: {
      localDate: '2026-01-01',
      timezone: 'Europe/Madrid',
    },
    occurredAt: new Date(occurredAt),
    qrChallengeId: null,
    source: AttendanceSource.REMOTE,
    tenantId: 'tenant-a',
    workplaceId: null,
  });
}
