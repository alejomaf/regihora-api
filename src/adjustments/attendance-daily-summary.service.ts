import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AttendanceDailySummaryEntity } from '../database/entities/attendance-daily-summary.entity';
import { AttendanceEventEntity } from '../database/entities/attendance-event.entity';
import { PunchAction } from '../domain/enums';

type DailySummaryCalculation = {
  firstClockInAt: Date | null;
  lastClockOutAt: Date | null;
  workedMinutes: number;
  breakMinutes: number;
  eventCount: number;
  openSession: boolean;
  openBreak: boolean;
};

@Injectable()
export class AttendanceDailySummaryService {
  constructor(
    @InjectRepository(AttendanceDailySummaryEntity)
    private readonly summaryRepository: Repository<AttendanceDailySummaryEntity>,
    @InjectRepository(AttendanceEventEntity)
    private readonly eventRepository: Repository<AttendanceEventEntity>,
  ) {}

  async recalculateEmployeeDay(
    tenantId: string,
    employeeId: string,
    localDate: string,
    timezone: string,
  ): Promise<AttendanceDailySummaryEntity> {
    const events = await this.eventRepository.find({
      order: {
        occurredAt: 'ASC',
        id: 'ASC',
      },
      where: {
        employeeId,
        tenantId,
      },
    });
    const dayEvents = events.filter(
      (event) => getEventLocalDate(event, timezone) === localDate,
    );
    const calculation = calculateDailySummary(dayEvents);
    const existingSummary = await this.summaryRepository.findOneBy({
      employeeId,
      localDate,
      tenantId,
    });
    const summary =
      existingSummary ??
      this.summaryRepository.create({
        employeeId,
        localDate,
        tenantId,
      });

    summary.breakMinutes = calculation.breakMinutes;
    summary.eventCount = calculation.eventCount;
    summary.firstClockInAt = calculation.firstClockInAt;
    summary.lastClockOutAt = calculation.lastClockOutAt;
    summary.openBreak = calculation.openBreak;
    summary.openSession = calculation.openSession;
    summary.timezone = timezone;
    summary.workedMinutes = calculation.workedMinutes;

    return this.summaryRepository.save(summary);
  }
}

function calculateDailySummary(events: AttendanceEventEntity[]): DailySummaryCalculation {
  let firstClockInAt: Date | null = null;
  let lastClockOutAt: Date | null = null;
  let activeClockInAt: Date | null = null;
  let activeBreakStartAt: Date | null = null;
  let workedMinutes = 0;
  let breakMinutes = 0;

  for (const event of events) {
    if (event.action === PunchAction.CLOCK_IN) {
      activeClockInAt = event.occurredAt;
      activeBreakStartAt = null;
      firstClockInAt = firstClockInAt ?? event.occurredAt;
      continue;
    }

    if (event.action === PunchAction.BREAK_START && activeClockInAt !== null) {
      activeBreakStartAt = event.occurredAt;
      continue;
    }

    if (event.action === PunchAction.BREAK_END && activeBreakStartAt !== null) {
      breakMinutes += getMinutesBetween(activeBreakStartAt, event.occurredAt);
      activeBreakStartAt = null;
      continue;
    }

    if (event.action === PunchAction.CLOCK_OUT && activeClockInAt !== null) {
      workedMinutes += getMinutesBetween(activeClockInAt, event.occurredAt);
      lastClockOutAt = event.occurredAt;
      activeClockInAt = null;
      activeBreakStartAt = null;
    }
  }

  return {
    breakMinutes,
    eventCount: events.length,
    firstClockInAt,
    lastClockOutAt,
    openBreak: activeBreakStartAt !== null,
    openSession: activeClockInAt !== null,
    workedMinutes: Math.max(0, workedMinutes - breakMinutes),
  };
}

function getMinutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
}

function getEventLocalDate(event: AttendanceEventEntity, fallbackTimezone: string): string {
  const metadataLocalDate = event.metadata.localDate;

  if (typeof metadataLocalDate === 'string' && metadataLocalDate.length > 0) {
    return metadataLocalDate;
  }

  const metadataTimezone = event.metadata.timezone;
  const timezone =
    typeof metadataTimezone === 'string' && metadataTimezone.length > 0
      ? metadataTimezone
      : fallbackTimezone;

  return new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: timezone,
    year: 'numeric',
  }).format(event.occurredAt);
}
