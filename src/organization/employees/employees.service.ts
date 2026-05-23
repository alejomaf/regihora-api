import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { parse as parseCsv } from 'csv-parse/sync';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';

import { AttendancePolicyEntity } from '../../database/entities/attendance-policy.entity';
import { DepartmentEntity } from '../../database/entities/department.entity';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { WorkplaceEntity } from '../../database/entities/workplace.entity';
import { EmployeeStatus, UserRole } from '../../domain/enums';
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
    tenantId: string,
    request: EmployeeCreateRequestDto,
  ): Promise<EmployeeDto> {
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

    await this.ensureEmailAvailable(tenantId, fields.email);
    await this.ensureTurnstileCodeAvailable(tenantId, fields.turnstileCodeHash);
    await this.ensureRelationsBelongToTenant(tenantId, fields);

    const employee = this.employeeRepository.create({
      ...fields,
      tenantId,
    });

    return toEmployeeDto(await this.employeeRepository.save(employee));
  }

  async get(tenantId: string, employeeId: string): Promise<EmployeeDto> {
    return toEmployeeDto(await this.getEntityOrFail(tenantId, employeeId));
  }

  async update(
    tenantId: string,
    employeeId: string,
    request: EmployeeUpdateRequestDto,
  ): Promise<EmployeeDto> {
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

    return toEmployeeDto(await this.employeeRepository.save(employee));
  }

  async delete(tenantId: string, employeeId: string): Promise<void> {
    const employee = await this.getEntityOrFail(tenantId, employeeId);

    employee.status = EmployeeStatus.INACTIVE;
    await this.employeeRepository.save(employee);
  }

  async invite(
    tenantId: string,
    employeeId: string,
  ): Promise<EmployeeInvitationDto> {
    const employee = await this.getEntityOrFail(tenantId, employeeId);

    if (employee.status !== EmployeeStatus.ACTIVE) {
      employee.status = EmployeeStatus.INVITED;
      await this.employeeRepository.save(employee);
    }

    return {
      employee: toEmployeeDto(employee),
      invited: true,
    };
  }

  async importCsv(
    tenantId: string,
    request: EmployeeCsvImportRequestDto | string,
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
        employees.push(toEmployeeDto(employee));

        if (sendInvitations && employee.status === EmployeeStatus.INVITED) {
          invited += 1;
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

    return [
      {
        ...baseWhere,
        displayName: ILike(`%${search}%`),
      },
      {
        ...baseWhere,
        email: ILike(`%${search}%`),
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
