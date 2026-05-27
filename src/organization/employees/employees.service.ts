import { createHash, randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { parse as parseCsv } from 'csv-parse/sync';
import { DataSource, FindOptionsWhere, ILike, IsNull, Repository } from 'typeorm';

import { AttendancePolicyEntity } from '../../database/entities/attendance-policy.entity';
import { AuditLogEntity } from '../../database/entities/audit-log.entity';
import { DepartmentEntity } from '../../database/entities/department.entity';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { EmployeeInvitationEntity } from '../../database/entities/employee-invitation.entity';
import { TenantEntity } from '../../database/entities/tenant.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { WorkplaceEntity } from '../../database/entities/workplace.entity';
import { EnvironmentVariables } from '../../config/environment.validation';
import { EmployeeStatus, UserRole } from '../../domain/enums';
import { EmailService } from '../../notifications/email.service';
import type { CurrentTenantContext } from '../../tenancy/types/current-tenant';
import { toEmployeeDto } from '../common/mappers';
import { parseRoles } from '../common/role-parsing';
import {
  getNextCursor,
  parseBoolean,
  parseOptionalEnumValue,
  parseOptionalNullableString,
  parseOptionalString,
  parsePageOptions,
  parseRequiredEmail,
  parseRequiredString,
} from '../common/request-parsing';
import {
  EmployeeCreateRequestDto,
  EmployeeCsvImportErrorDto,
  EmployeeCsvImportRequestDto,
  EmployeeCsvImportResponseDto,
  EmployeeDto,
  EmployeeInvitationDto,
  EmployeeUpdateRequestDto,
  ListQueryDto,
  PaginatedResponseDto,
} from '../dto/organization.dto';

type EmployeeCsvRecord = Record<string, string | undefined>;

type EmployeeWriteFields = {
  displayName: string;
  email: string;
  roles: UserRole[];
  status: EmployeeStatus;
  workplaceId: string | null;
  departmentId: string | null;
  attendancePolicyId: string | null;
  turnstileCodeHash: string | null;
};

type EmployeeRelationFields = {
  workplaceId: string | null | undefined;
  departmentId: string | null | undefined;
  attendancePolicyId: string | null | undefined;
};

@Injectable()
export class EmployeesService {
  constructor(
    @InjectRepository(EmployeeEntity)
    private readonly employeeRepository: Repository<EmployeeEntity>,
    @InjectRepository(WorkplaceEntity)
    private readonly workplaceRepository: Repository<WorkplaceEntity>,
    @InjectRepository(DepartmentEntity)
    private readonly departmentRepository: Repository<DepartmentEntity>,
    @InjectRepository(AttendancePolicyEntity)
    private readonly attendancePolicyRepository: Repository<AttendancePolicyEntity>,
    @InjectRepository(TenantEntity)
    private readonly tenantRepository: Repository<TenantEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(EmployeeInvitationEntity)
    private readonly employeeInvitationRepository: Repository<EmployeeInvitationEntity>,
    @InjectRepository(AuditLogEntity)
    private readonly auditLogRepository: Repository<AuditLogEntity>,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
    private readonly emailService: EmailService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async list(
    tenantId: string,
    query: ListQueryDto,
  ): Promise<PaginatedResponseDto<EmployeeDto>> {
    const { limit, offset } = parsePageOptions(query);
    const status = parseOptionalEnumValue(
      query.status,
      EmployeeStatus,
      'status',
    );
    const search = parseOptionalString(query.search, 'search', 120);
    const workplaceId = parseOptionalString(query.workplaceId, 'workplaceId', 80);
    const departmentId = parseOptionalString(query.departmentId, 'departmentId', 80);
    const where = this.buildListWhere(
      tenantId,
      status,
      workplaceId,
      departmentId,
      search,
    );
    const [employees, totalCount] = await this.employeeRepository.findAndCount({
      order: {
        createdAt: 'DESC',
        id: 'ASC',
      },
      skip: offset,
      take: limit,
      where,
    });

    return {
      data: employees.map(toEmployeeDto),
      pagination: {
        nextCursor: getNextCursor(offset, employees.length, totalCount),
      },
    };
  }

  async create(
    actor: CurrentTenantContext,
    request: EmployeeCreateRequestDto,
  ): Promise<EmployeeDto> {
    const tenantId = actor.tenantId;
    const fields = {
      attendancePolicyId: parseOptionalString(
        request.attendancePolicyId,
        'attendancePolicyId',
        80,
      ) ?? null,
      departmentId:
        parseOptionalString(request.departmentId, 'departmentId', 80) ?? null,
      displayName: parseRequiredString(request.displayName, 'displayName', 160),
      email: parseRequiredEmail(request.email),
      roles: parseRoles(request.roles),
      status: EmployeeStatus.INVITED,
      turnstileCodeHash: hashOptionalTurnstileCode(request.turnstileCode),
      workplaceId:
        parseOptionalString(request.workplaceId, 'workplaceId', 80) ?? null,
    };

    if (fields.roles.includes(UserRole.OWNER) && !actor.roles.includes(UserRole.OWNER)) {
      throw new ForbiddenException('Only an owner can assign the OWNER role.');
    }

    await this.ensureEmailAvailable(tenantId, fields.email);
    await this.ensureTurnstileCodeAvailable(tenantId, fields.turnstileCodeHash);
    await this.ensureRelationsBelongToTenant(tenantId, fields);

    const employee = this.employeeRepository.create({
      ...fields,
      tenantId,
    });

    const saved = await this.employeeRepository.save(employee);

    await this.auditLogRepository.save(
      this.auditLogRepository.create({
        action: 'employee.created',
        actorEmployeeId: actor.employeeId,
        actorUserId: actor.userId,
        entityId: saved.id,
        entityType: 'employee',
        metadata: { email: fields.email, roles: fields.roles },
        tenantId,
      }),
    );

    return toEmployeeDto(saved);
  }

  async get(tenantId: string, employeeId: string): Promise<EmployeeDto> {
    return toEmployeeDto(await this.getEntityOrFail(tenantId, employeeId));
  }

  async update(
    actor: CurrentTenantContext,
    employeeId: string,
    request: EmployeeUpdateRequestDto,
  ): Promise<EmployeeDto> {
    const tenantId = actor.tenantId;
    const employee = await this.getEntityOrFail(tenantId, employeeId);
    const displayName = parseOptionalString(request.displayName, 'displayName', 160);
    const status = parseOptionalEnumValue(
      request.status,
      EmployeeStatus,
      'status',
    );
    const roles =
      request.roles === undefined ? undefined : parseRoles(request.roles);
    const workplaceId = parseOptionalNullableString(
      request.workplaceId,
      'workplaceId',
      80,
    );
    const departmentId = parseOptionalNullableString(
      request.departmentId,
      'departmentId',
      80,
    );
    const attendancePolicyId = parseOptionalNullableString(
      request.attendancePolicyId,
      'attendancePolicyId',
      80,
    );
    const turnstileCodeHash =
      request.turnstileCode === undefined
        ? undefined
        : hashOptionalNullableTurnstileCode(request.turnstileCode);
    const relationFields: EmployeeRelationFields = {
      attendancePolicyId,
      departmentId,
      workplaceId,
    };

    if (roles !== undefined) {
      if (roles.includes(UserRole.OWNER) && !actor.roles.includes(UserRole.OWNER)) {
        throw new ForbiddenException('Only an owner can assign the OWNER role.');
      }

      const isRemovingOwnerRole =
        employee.roles.includes(UserRole.OWNER) && !roles.includes(UserRole.OWNER);

      if (isRemovingOwnerRole) {
        const tenantEmployees = await this.employeeRepository.find({
          select: ['id', 'roles'],
          where: { status: EmployeeStatus.ACTIVE, tenantId },
        });
        const otherOwnerExists = tenantEmployees.some(
          (e) => e.id !== employee.id && e.roles.includes(UserRole.OWNER),
        );

        if (!otherOwnerExists) {
          throw new ForbiddenException('Cannot remove the last owner of the tenant.');
        }
      }
    }

    await this.ensureRelationsBelongToTenant(tenantId, relationFields);
    await this.ensureTurnstileCodeAvailable(
      tenantId,
      turnstileCodeHash,
      employee.id,
    );

    if (displayName !== undefined) {
      employee.displayName = displayName;
    }

    if (status !== undefined) {
      employee.status = status;
    }

    if (roles !== undefined) {
      employee.roles = roles;
    }

    if (workplaceId !== undefined) {
      employee.workplaceId = workplaceId;
    }

    if (departmentId !== undefined) {
      employee.departmentId = departmentId;
    }

    if (attendancePolicyId !== undefined) {
      employee.attendancePolicyId = attendancePolicyId;
    }

    if (turnstileCodeHash !== undefined) {
      employee.turnstileCodeHash = turnstileCodeHash;
    }

    const saved = await this.employeeRepository.save(employee);

    await this.auditLogRepository.save(
      this.auditLogRepository.create({
        action: 'employee.updated',
        actorEmployeeId: actor.employeeId,
        actorUserId: actor.userId,
        entityId: saved.id,
        entityType: 'employee',
        metadata: {
          ...(roles !== undefined && { roles }),
          ...(status !== undefined && { status }),
        },
        tenantId,
      }),
    );

    return toEmployeeDto(saved);
  }

  async delete(actor: CurrentTenantContext, employeeId: string): Promise<void> {
    const tenantId = actor.tenantId;
    const employee = await this.getEntityOrFail(tenantId, employeeId);

    if (employee.roles.includes(UserRole.OWNER) && !actor.roles.includes(UserRole.OWNER)) {
      throw new ForbiddenException('Only an owner can deactivate another owner.');
    }

    employee.status = EmployeeStatus.INACTIVE;
    await this.employeeRepository.save(employee);

    await this.auditLogRepository.save(
      this.auditLogRepository.create({
        action: 'employee.deactivated',
        actorEmployeeId: actor.employeeId,
        actorUserId: actor.userId,
        entityId: employee.id,
        entityType: 'employee',
        metadata: {},
        tenantId,
      }),
    );
  }

  async invite(
    tenantId: string,
    employeeId: string,
    actorUserId: string,
    actorEmployeeId: string | null,
  ): Promise<EmployeeInvitationDto> {
    const employee = await this.getEntityOrFail(tenantId, employeeId);
    const tenant = await this.tenantRepository.findOneBy({ id: tenantId });

    if (tenant === null) {
      throw new NotFoundException('Tenant not found.');
    }

    if (employee.status === EmployeeStatus.INACTIVE) {
      throw new BadRequestException('Inactive employees cannot be invited.');
    }

    if (employee.status === EmployeeStatus.ACTIVE && employee.userId !== null) {
      throw new ConflictException('Employee already has active access.');
    }

    const now = new Date();
    const token = generateInvitationToken();
    const expiresAt = new Date(
      now.getTime() +
        this.configService.get('EMPLOYEE_INVITATION_TTL_HOURS', { infer: true }) *
          60 *
          60 *
          1_000,
    );
    const acceptUrl = buildInvitationAcceptUrl(
      this.configService.get('WEBAPP_BASE_URL', { infer: true }),
      token,
    );

    const invitation = await this.dataSource.transaction(async (manager) => {
      await manager.update(
        EmployeeInvitationEntity,
        { acceptedAt: IsNull(), employeeId: employee.id, revokedAt: IsNull(), tenantId },
        { revokedAt: now },
      );

      if (employee.status !== EmployeeStatus.INVITED) {
        employee.status = EmployeeStatus.INVITED;
        await manager.save(EmployeeEntity, employee);
      }

      return manager.save(
        EmployeeInvitationEntity,
        manager.create(EmployeeInvitationEntity, {
          acceptedAt: null,
          email: employee.email,
          employeeId: employee.id,
          expiresAt,
          invitedByUserId: actorUserId,
          revokedAt: null,
          sentAt: null,
          tenantId,
          tokenHash: hashInvitationToken(token),
        }),
      );
    });
    const existingUser = await this.userRepository.findOneBy({ email: employee.email });
    const delivery = await this.emailService.send(
      buildEmployeeInvitationEmail({
        acceptUrl,
        displayName: employee.displayName,
        email: employee.email,
        expiresAt,
        hasExistingAccount: existingUser !== null && existingUser.passwordHash !== null,
        tenantName: tenant.legalName,
      }),
    );

    if (delivery.status === 'SENT') {
      invitation.sentAt = new Date();
      await this.employeeInvitationRepository.save(invitation);
    }

    await this.auditLogRepository.save(
      this.auditLogRepository.create({
        action: 'employee.invitation.created',
        actorEmployeeId,
        actorUserId,
        entityId: employee.id,
        entityType: 'employee',
        metadata: {
          deliveryStatus: delivery.status,
          invitationId: invitation.id,
        },
        tenantId,
      }),
    );

    return {
      acceptUrl,
      deliveryStatus: delivery.status,
      emailSent: delivery.status === 'SENT',
      employee: toEmployeeDto(employee),
      expiresAt: expiresAt.toISOString(),
      invited: true,
    };
  }

  async importCsv(
    tenantId: string,
    request: EmployeeCsvImportRequestDto | string,
    actorUserId?: string,
    actorEmployeeId?: string | null,
  ): Promise<EmployeeCsvImportResponseDto> {
    const { csv, sendInvitations } = this.parseImportRequest(request);
    const records = this.parseCsvRecords(csv);
    const errors: EmployeeCsvImportErrorDto[] = [];
    const employees: EmployeeDto[] = [];
    let invited = 0;

    for (const [index, record] of records.entries()) {
      try {
        const employee = await this.importRecord(
          tenantId,
          record,
          sendInvitations,
        );

        if (sendInvitations && employee.status === EmployeeStatus.INVITED) {
          if (actorUserId !== undefined) {
            const invitation = await this.invite(
              tenantId,
              employee.id,
              actorUserId,
              actorEmployeeId ?? null,
            );

            employees.push(invitation.employee);
          } else {
            employees.push(toEmployeeDto(employee));
          }

          invited += 1;
        } else {
          employees.push(toEmployeeDto(employee));
        }
      } catch (error) {
        errors.push({
          message: error instanceof Error ? error.message : 'Invalid row.',
          row: index + 2,
        });
      }
    }

    return {
      employees,
      errors,
      imported: employees.length,
      invited,
      skipped: errors.length,
    };
  }

  private buildListWhere(
    tenantId: string,
    status: EmployeeStatus | undefined,
    workplaceId: string | undefined,
    departmentId: string | undefined,
    search: string | undefined,
  ): FindOptionsWhere<EmployeeEntity> | FindOptionsWhere<EmployeeEntity>[] {
    const baseWhere: FindOptionsWhere<EmployeeEntity> = {
      tenantId,
      ...(departmentId === undefined ? {} : { departmentId }),
      ...(status === undefined ? {} : { status }),
      ...(workplaceId === undefined ? {} : { workplaceId }),
    };

    if (search === undefined) {
      return baseWhere;
    }

    const escaped = escapeLikePattern(search);

    return [
      {
        ...baseWhere,
        displayName: ILike(`%${escaped}%`),
      },
      {
        ...baseWhere,
        email: ILike(`%${escaped}%`),
      },
    ];
  }

  private async importRecord(
    tenantId: string,
    record: EmployeeCsvRecord,
    sendInvitations: boolean,
  ): Promise<EmployeeEntity> {
    const status = sendInvitations
      ? EmployeeStatus.INVITED
      : parseOptionalEnumValue(record.status, EmployeeStatus, 'status') ??
        EmployeeStatus.INVITED;
    const fields: EmployeeWriteFields = {
      attendancePolicyId: getRecordValue(record, 'attendancePolicyId') ?? null,
      departmentId: getRecordValue(record, 'departmentId') ?? null,
      displayName: parseRequiredString(
        getRecordValue(record, 'displayName', 'display_name', 'name'),
        'displayName',
        160,
      ),
      email: parseRequiredEmail(getRecordValue(record, 'email')),
      roles: parseRoles(getRecordValue(record, 'roles'), [UserRole.EMPLOYEE]),
      status,
      turnstileCodeHash: hashOptionalTurnstileCode(
        getRecordValue(record, 'turnstileCode', 'turnstile_code', 'badgeCode', 'badge_code'),
      ),
      workplaceId: getRecordValue(record, 'workplaceId') ?? null,
    };

    await this.ensureRelationsBelongToTenant(tenantId, fields);

    const existingEmployee = await this.employeeRepository.findOneBy({
      email: fields.email,
      tenantId,
    });
    const employee =
      existingEmployee ??
      this.employeeRepository.create({
        email: fields.email,
        tenantId,
      });

    await this.ensureTurnstileCodeAvailable(
      tenantId,
      fields.turnstileCodeHash,
      existingEmployee?.id,
    );

    employee.attendancePolicyId = fields.attendancePolicyId;
    employee.departmentId = fields.departmentId;
    employee.displayName = fields.displayName;
    employee.roles = fields.roles;
    employee.status = fields.status;
    employee.turnstileCodeHash = fields.turnstileCodeHash;
    employee.workplaceId = fields.workplaceId;

    return this.employeeRepository.save(employee);
  }

  private parseImportRequest(
    request: EmployeeCsvImportRequestDto | string,
  ): { csv: string; sendInvitations: boolean } {
    if (typeof request === 'string') {
      return {
        csv: parseRequiredString(request, 'csv', 1_000_000),
        sendInvitations: false,
      };
    }

    return {
      csv: parseRequiredString(request.csv, 'csv', 1_000_000),
      sendInvitations: parseBoolean(request.sendInvitations, false),
    };
  }

  private parseCsvRecords(csv: string): EmployeeCsvRecord[] {
    try {
      return parseCsv(csv, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch {
      throw new BadRequestException('CSV is malformed.');
    }
  }

  private async ensureEmailAvailable(
    tenantId: string,
    email: string,
  ): Promise<void> {
    const existingEmployee = await this.employeeRepository.findOneBy({
      email,
      tenantId,
    });

    if (existingEmployee !== null) {
      throw new ConflictException('Employee email already exists.');
    }
  }

  private async ensureTurnstileCodeAvailable(
    tenantId: string,
    turnstileCodeHash: string | null | undefined,
    exceptEmployeeId?: string,
  ): Promise<void> {
    if (turnstileCodeHash === undefined || turnstileCodeHash === null) {
      return;
    }

    const existingEmployee = await this.employeeRepository.findOneBy({
      tenantId,
      turnstileCodeHash,
    });

    if (existingEmployee !== null && existingEmployee.id !== exceptEmployeeId) {
      throw new ConflictException('Turnstile code is already assigned to another employee.');
    }
  }

  private async ensureRelationsBelongToTenant(
    tenantId: string,
    fields: EmployeeRelationFields,
  ): Promise<void> {
    await this.ensureOptionalTenantRelation(
      this.workplaceRepository,
      tenantId,
      fields.workplaceId,
      'Workplace',
    );
    await this.ensureOptionalTenantRelation(
      this.departmentRepository,
      tenantId,
      fields.departmentId,
      'Department',
    );
    await this.ensureOptionalTenantRelation(
      this.attendancePolicyRepository,
      tenantId,
      fields.attendancePolicyId,
      'Attendance policy',
    );
  }

  private async ensureOptionalTenantRelation(
    repository: Repository<{ id: string; tenantId: string }>,
    tenantId: string,
    entityId: string | null | undefined,
    entityName: string,
  ): Promise<void> {
    if (entityId === undefined || entityId === null) {
      return;
    }

    const exists = await repository.existsBy({
      id: entityId,
      tenantId,
    });

    if (!exists) {
      throw new NotFoundException(`${entityName} not found.`);
    }
  }

  private async getEntityOrFail(
    tenantId: string,
    employeeId: string,
  ): Promise<EmployeeEntity> {
    const employee = await this.employeeRepository.findOneBy({
      id: employeeId,
      tenantId,
    });

    if (employee === null) {
      throw new NotFoundException('Employee not found.');
    }

    return employee;
  }

}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function hashOptionalTurnstileCode(value: unknown): string | null {
  const code = parseOptionalString(value, 'turnstileCode', 512);

  return code === undefined ? null : hashTurnstileCode(code);
}

function hashOptionalNullableTurnstileCode(value: unknown): string | null {
  if (value === null) {
    return null;
  }

  return hashOptionalTurnstileCode(value);
}

function hashTurnstileCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function generateInvitationToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function buildInvitationAcceptUrl(webappBaseUrl: string, token: string): string {
  const url = new URL('/aceptar-invitacion', `${webappBaseUrl}/`);

  url.searchParams.set('token', token);

  return url.toString();
}

function buildEmployeeInvitationEmail(input: {
  acceptUrl: string;
  displayName: string;
  email: string;
  expiresAt: Date;
  hasExistingAccount: boolean;
  tenantName: string;
}): {
  html: string;
  subject: string;
  text: string;
  to: string;
} {
  const subject = `${input.tenantName} te ha invitado a RegiHora`;
  const accountLine = input.hasExistingAccount
    ? 'Ya tienes una cuenta de RegiHora: al aceptar se añadirá esta empresa a tu acceso actual.'
    : 'Crea tu contraseña al aceptar la invitación para empezar a fichar.';
  const expiresAt = new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Madrid',
  }).format(input.expiresAt);
  const text = [
    `Hola ${input.displayName},`,
    '',
    `${input.tenantName} te ha invitado a RegiHora para registrar tu jornada laboral.`,
    accountLine,
    `La invitación caduca el ${expiresAt}.`,
    '',
    `Aceptar invitación: ${input.acceptUrl}`,
  ].join('\n');
  const html = `
    <p>Hola ${escapeHtml(input.displayName)},</p>
    <p>${escapeHtml(input.tenantName)} te ha invitado a RegiHora para registrar tu jornada laboral.</p>
    <p>${escapeHtml(accountLine)}</p>
    <p>La invitación caduca el ${escapeHtml(expiresAt)}.</p>
    <p><a href="${escapeHtml(input.acceptUrl)}">Aceptar invitación</a></p>
  `;

  return {
    html,
    subject,
    text,
    to: input.email,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getRecordValue(
  record: EmployeeCsvRecord,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key];

    if (value !== undefined && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}
