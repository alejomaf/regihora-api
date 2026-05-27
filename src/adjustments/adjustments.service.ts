import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';

import { toAttendanceAdjustmentDto } from './adjustments.mapper';
import { AttendanceDailySummaryService } from './attendance-daily-summary.service';
import {
  AdjustmentDecisionRequestDto,
  AttendanceAdjustmentCreateRequestDto,
  AttendanceAdjustmentDto,
  AttendanceAdjustmentListQueryDto,
  AttendanceAdjustmentListResponseDto,
} from './dto/adjustment.dto';
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
} from '../domain/enums';
import { getAttendanceSessionState, isActionAllowedForState } from '../attendance/session-state';
import {
  getNextCursor,
  parseEnumValue,
  parseOptionalEnumValue,
  parseOptionalString,
  parsePageOptions,
  parseRequiredString,
} from '../organization/common/request-parsing';
import type { CurrentTenantContext } from '../tenancy/types/current-tenant';

type ProposedPunchFields = {
  action: PunchAction;
  occurredAt: Date;
  workplaceId: string | null;
};

const managerRoles = new Set<UserRole>([
  UserRole.HR_ADMIN,
  UserRole.MANAGER,
  UserRole.OWNER,
]);

const readerRoles = new Set<UserRole>([
  UserRole.AUDITOR,
  UserRole.HR_ADMIN,
  UserRole.MANAGER,
  UserRole.OWNER,
]);

@Injectable()
export class AdjustmentsService {
  constructor(
    @InjectRepository(AttendanceAdjustmentEntity)
    private readonly adjustmentRepository: Repository<AttendanceAdjustmentEntity>,
    @InjectRepository(AttendanceEventEntity)
    private readonly eventRepository: Repository<AttendanceEventEntity>,
    @InjectRepository(AuditLogEntity)
    private readonly auditLogRepository: Repository<AuditLogEntity>,
    @InjectRepository(EmployeeEntity)
    private readonly employeeRepository: Repository<EmployeeEntity>,
    @InjectRepository(TenantEntity)
    private readonly tenantRepository: Repository<TenantEntity>,
    @InjectRepository(WorkplaceEntity)
    private readonly workplaceRepository: Repository<WorkplaceEntity>,
    private readonly dailySummaryService: AttendanceDailySummaryService,
  ) {}

  async list(
    currentTenant: CurrentTenantContext,
    query: AttendanceAdjustmentListQueryDto,
  ): Promise<AttendanceAdjustmentListResponseDto> {
    const { limit, offset } = parsePageOptions(query);
    const canReadTenant = hasAnyRole(currentTenant.roles, readerRoles);
    const requestedEmployeeId = parseOptionalString(query.employeeId, 'employeeId', 80);
    const employeeId = canReadTenant
      ? requestedEmployeeId
      : currentTenant.employeeId;
    const status = parseOptionalEnumValue(
      query.status,
      AdjustmentStatus,
      'status',
    );
    const where: FindOptionsWhere<AttendanceAdjustmentEntity> = {
      tenantId: currentTenant.tenantId,
      ...(employeeId === undefined ? {} : { employeeId }),
      ...(status === undefined ? {} : { status }),
    };
    const [adjustments, totalCount] = await this.adjustmentRepository.findAndCount({
      order: {
        requestedAt: 'DESC',
        id: 'ASC',
      },
      skip: offset,
      take: limit,
      where,
    });

    return {
      data: adjustments.map(toAttendanceAdjustmentDto),
      pagination: {
        nextCursor: getNextCursor(offset, adjustments.length, totalCount),
      },
    };
  }

  async create(
    currentTenant: CurrentTenantContext,
    request: AttendanceAdjustmentCreateRequestDto,
  ): Promise<AttendanceAdjustmentDto> {
    const employeeId = parseRequiredString(request.employeeId, 'employeeId', 80);

    if (employeeId !== currentTenant.employeeId) {
      throw new ForbiddenException('Employees can only request their own adjustments.');
    }

    const proposedPunch = parseProposedPunch(request.proposedPunch);

    if (proposedPunch.occurredAt > new Date()) {
      throw new BadRequestException('proposedPunch.occurredAt cannot be in the future.');
    }

    const reason = parseRequiredString(request.reason, 'reason', 1000);
    const originalPunchId = parseOptionalString(
      request.originalPunchId,
      'originalPunchId',
      80,
    );

    if (reason.length < 3) {
      throw new BadRequestException('reason must be at least 3 characters.');
    }

    await this.getActiveEmployee(currentTenant.tenantId, employeeId);
    await this.ensureWorkplaceBelongsToTenant(
      currentTenant.tenantId,
      proposedPunch.workplaceId,
    );
    await this.ensureOriginalEventBelongsToEmployee(
      currentTenant.tenantId,
      employeeId,
      originalPunchId,
    );

    const now = new Date();
    const adjustment = this.adjustmentRepository.create({
      employeeId,
      originalEventId: originalPunchId ?? null,
      proposedAction: proposedPunch.action,
      proposedOccurredAt: proposedPunch.occurredAt,
      proposedWorkplaceId: proposedPunch.workplaceId,
      reason,
      requestedAt: now,
      requestedByUserId: currentTenant.userId,
      status: AdjustmentStatus.PENDING,
      tenantId: currentTenant.tenantId,
    });
    const savedAdjustment = await this.adjustmentRepository.save(adjustment);

    await this.createAuditLog(currentTenant, savedAdjustment.id, 'adjustment.requested', {
      employeeId,
      originalPunchId: originalPunchId ?? null,
      proposedAction: proposedPunch.action,
      proposedOccurredAt: proposedPunch.occurredAt.toISOString(),
      proposedWorkplaceId: proposedPunch.workplaceId,
    });

    return toAttendanceAdjustmentDto(savedAdjustment);
  }

  async get(
    currentTenant: CurrentTenantContext,
    adjustmentId: string,
  ): Promise<AttendanceAdjustmentDto> {
    const adjustment = await this.getAdjustmentOrFail(
      currentTenant.tenantId,
      adjustmentId,
    );

    this.ensureCanReadAdjustment(currentTenant, adjustment);

    return toAttendanceAdjustmentDto(adjustment);
  }

  async approve(
    currentTenant: CurrentTenantContext,
    adjustmentId: string,
    request: AdjustmentDecisionRequestDto,
  ): Promise<AttendanceAdjustmentDto> {
    this.ensureCanDecide(currentTenant);

    const adjustment = await this.getPendingAdjustmentOrFail(
      currentTenant.tenantId,
      adjustmentId,
    );

    if (currentTenant.employeeId === adjustment.employeeId) {
      throw new ForbiddenException('An employee cannot approve their own adjustment.');
    }

    await this.ensureValidShiftTransition(adjustment);

    const decisionReason =
      parseOptionalString(request.decisionReason, 'decisionReason', 1000) ?? null;
    const tenant = await this.getTenant(currentTenant.tenantId);
    const timezone = await this.getAdjustmentTimezone(adjustment, tenant.timezone);
    const localDate = formatLocalDate(adjustment.proposedOccurredAt, timezone);
    const resultingEvent = this.eventRepository.create({
      action: adjustment.proposedAction,
      adjustmentId: adjustment.id,
      createdByUserId: currentTenant.userId,
      deviceId: null,
      employeeId: adjustment.employeeId,
      eventType: AttendanceEventType.ADJUSTMENT,
      gpsProvided: false,
      gpsRequiredByPolicy: false,
      idempotencyKey: null,
      metadata: {
        adjustmentId: adjustment.id,
        decisionReason,
        localDate,
        reason: adjustment.reason,
        requestedByUserId: adjustment.requestedByUserId,
        timezone,
      },
      occurredAt: adjustment.proposedOccurredAt,
      qrChallengeId: null,
      source: AttendanceSource.MANUAL_ADJUSTMENT,
      tenantId: adjustment.tenantId,
      workplaceId: adjustment.proposedWorkplaceId,
    });
    const savedEvent = await this.eventRepository.save(resultingEvent);

    adjustment.decidedAt = new Date();
    adjustment.decidedByUserId = currentTenant.userId;
    adjustment.decisionReason = decisionReason;
    adjustment.resultingEventId = savedEvent.id;
    adjustment.status = AdjustmentStatus.APPROVED;

    const savedAdjustment = await this.adjustmentRepository.save(adjustment);

    await this.createAuditLog(currentTenant, adjustment.id, 'adjustment.approved', {
      decisionReason,
      resultingEventId: savedEvent.id,
    });
    await this.createAuditLog(currentTenant, savedEvent.id, 'attendance_event.created_from_adjustment', {
      adjustmentId: adjustment.id,
      employeeId: adjustment.employeeId,
      occurredAt: savedEvent.occurredAt.toISOString(),
    });
    await this.recalculateImpactedDays(adjustment, timezone, localDate);

    return toAttendanceAdjustmentDto(savedAdjustment);
  }

  async reject(
    currentTenant: CurrentTenantContext,
    adjustmentId: string,
    request: AdjustmentDecisionRequestDto,
  ): Promise<AttendanceAdjustmentDto> {
    this.ensureCanDecide(currentTenant);

    const adjustment = await this.getPendingAdjustmentOrFail(
      currentTenant.tenantId,
      adjustmentId,
    );
    const decisionReason = parseRequiredString(
      request.decisionReason,
      'decisionReason',
      1000,
    );

    adjustment.decidedAt = new Date();
    adjustment.decidedByUserId = currentTenant.userId;
    adjustment.decisionReason = decisionReason;
    adjustment.status = AdjustmentStatus.REJECTED;

    const savedAdjustment = await this.adjustmentRepository.save(adjustment);

    await this.createAuditLog(currentTenant, adjustment.id, 'adjustment.rejected', {
      decisionReason,
    });

    return toAttendanceAdjustmentDto(savedAdjustment);
  }

  private ensureCanReadAdjustment(
    currentTenant: CurrentTenantContext,
    adjustment: AttendanceAdjustmentEntity,
  ): void {
    if (
      adjustment.employeeId !== currentTenant.employeeId &&
      !hasAnyRole(currentTenant.roles, readerRoles)
    ) {
      throw new ForbiddenException('Adjustment access denied.');
    }
  }

  private ensureCanDecide(currentTenant: CurrentTenantContext): void {
    if (!hasAnyRole(currentTenant.roles, managerRoles)) {
      throw new ForbiddenException('Only managers or admins can decide adjustments.');
    }
  }

  private async getAdjustmentOrFail(
    tenantId: string,
    adjustmentId: string,
  ): Promise<AttendanceAdjustmentEntity> {
    const adjustment = await this.adjustmentRepository.findOneBy({
      id: adjustmentId,
      tenantId,
    });

    if (adjustment === null) {
      throw new NotFoundException('Attendance adjustment not found.');
    }

    return adjustment;
  }

  private async getPendingAdjustmentOrFail(
    tenantId: string,
    adjustmentId: string,
  ): Promise<AttendanceAdjustmentEntity> {
    const adjustment = await this.getAdjustmentOrFail(tenantId, adjustmentId);

    if (adjustment.status !== AdjustmentStatus.PENDING) {
      throw new ConflictException('Attendance adjustment has already been decided.');
    }

    return adjustment;
  }

  private async getActiveEmployee(
    tenantId: string,
    employeeId: string,
  ): Promise<EmployeeEntity> {
    const employee = await this.employeeRepository.findOneBy({
      id: employeeId,
      tenantId,
    });

    if (employee?.status !== EmployeeStatus.ACTIVE) {
      throw new ForbiddenException('Employee is not active.');
    }

    return employee;
  }

  private async getTenant(tenantId: string): Promise<TenantEntity> {
    const tenant = await this.tenantRepository.findOneBy({ id: tenantId });

    if (tenant === null) {
      throw new NotFoundException('Tenant not found.');
    }

    return tenant;
  }

  private async ensureWorkplaceBelongsToTenant(
    tenantId: string,
    workplaceId: string | null,
  ): Promise<void> {
    if (workplaceId === null) {
      return;
    }

    const workplace = await this.workplaceRepository.findOneBy({
      id: workplaceId,
      tenantId,
    });

    if (workplace === null) {
      throw new NotFoundException('Workplace not found.');
    }

    if (workplace.status !== ResourceStatus.ACTIVE) {
      throw new ConflictException('Workplace is not active.');
    }
  }

  private async ensureOriginalEventBelongsToEmployee(
    tenantId: string,
    employeeId: string,
    originalPunchId: string | undefined,
  ): Promise<void> {
    if (originalPunchId === undefined) {
      return;
    }

    const event = await this.eventRepository.findOneBy({
      employeeId,
      id: originalPunchId,
      tenantId,
    });

    if (event === null) {
      throw new NotFoundException('Original punch not found.');
    }
  }

  private async getAdjustmentTimezone(
    adjustment: AttendanceAdjustmentEntity,
    fallbackTimezone: string,
  ): Promise<string> {
    if (adjustment.proposedWorkplaceId === null) {
      return fallbackTimezone;
    }

    const workplace = await this.workplaceRepository.findOneBy({
      id: adjustment.proposedWorkplaceId,
      tenantId: adjustment.tenantId,
    });

    return workplace?.timezone ?? fallbackTimezone;
  }

  private async recalculateImpactedDays(
    adjustment: AttendanceAdjustmentEntity,
    timezone: string,
    proposedLocalDate: string,
  ): Promise<void> {
    await this.dailySummaryService.recalculateEmployeeDay(
      adjustment.tenantId,
      adjustment.employeeId,
      proposedLocalDate,
      timezone,
    );

    if (adjustment.originalEventId === null) {
      return;
    }

    const originalEvent = await this.eventRepository.findOneBy({
      id: adjustment.originalEventId,
      tenantId: adjustment.tenantId,
    });

    if (originalEvent === null) {
      return;
    }

    const originalLocalDate = getEventLocalDate(originalEvent, timezone);

    if (originalLocalDate === proposedLocalDate) {
      return;
    }

    await this.dailySummaryService.recalculateEmployeeDay(
      adjustment.tenantId,
      adjustment.employeeId,
      originalLocalDate,
      timezone,
    );
  }

  private async ensureValidShiftTransition(
    adjustment: AttendanceAdjustmentEntity,
  ): Promise<void> {
    const lastEvent = await this.eventRepository.findOne({
      order: { occurredAt: 'DESC' },
      where: {
        employeeId: adjustment.employeeId,
        eventType: AttendanceEventType.PUNCH,
        tenantId: adjustment.tenantId,
      },
    });
    const state = getAttendanceSessionState(lastEvent?.action);

    if (!isActionAllowedForState(adjustment.proposedAction, state)) {
      throw new ConflictException(
        'Proposed punch action is not valid for the current session state.',
      );
    }
  }

  private async createAuditLog(
    currentTenant: CurrentTenantContext,
    entityId: string,
    action: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.auditLogRepository.save(
      this.auditLogRepository.create({
        action,
        actorEmployeeId: currentTenant.employeeId,
        actorUserId: currentTenant.userId,
        entityId,
        entityType: action.startsWith('attendance_event') ? 'attendance_event' : 'adjustment',
        metadata,
        tenantId: currentTenant.tenantId,
      }),
    );
  }
}

function parseProposedPunch(value: unknown): ProposedPunchFields {
  if (!isRecord(value)) {
    throw new BadRequestException('proposedPunch is required.');
  }

  return {
    action: parseEnumValue(value.direction, PunchAction, 'proposedPunch.direction'),
    occurredAt: parseDate(value.occurredAt, 'proposedPunch.occurredAt'),
    workplaceId: parseNullableString(value.workplaceId, 'proposedPunch.workplaceId', 80),
  };
}

function parseDate(value: unknown, name: string): Date {
  const rawValue = parseRequiredString(value, name, 80);
  const date = new Date(rawValue);

  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${name} must be a valid date-time.`);
  }

  return date;
}

function parseNullableString(
  value: unknown,
  name: string,
  maxLength: number,
): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  return parseRequiredString(value, name, maxLength);
}

function hasAnyRole(roles: UserRole[], allowedRoles: Set<UserRole>): boolean {
  return roles.some((role) => allowedRoles.has(role));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function formatLocalDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: timezone,
    year: 'numeric',
  }).format(date);
}

function getEventLocalDate(event: AttendanceEventEntity, fallbackTimezone: string): string {
  const metadataLocalDate = event.metadata.localDate;

  if (typeof metadataLocalDate === 'string' && metadataLocalDate.length > 0) {
    return metadataLocalDate;
  }

  return formatLocalDate(event.occurredAt, fallbackTimezone);
}
