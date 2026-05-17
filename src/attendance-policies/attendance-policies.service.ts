import { isIP } from 'node:net';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, In, Repository } from 'typeorm';

import { AttendancePolicyEntity } from '../database/entities/attendance-policy.entity';
import { WorkplaceEntity } from '../database/entities/workplace.entity';
import { AttendancePolicyMode, ResourceStatus } from '../domain/enums';
import {
  getNextCursor,
  parseBoolean,
  parseEnumValue,
  parseOptionalEnumValue,
  parseOptionalString,
  parsePageOptions,
  parseRequiredString,
} from '../organization/common/request-parsing';
import { toAttendancePolicyDto } from './attendance-policies.mapper';
import {
  AttendancePolicyAutoCheckoutDto,
  AttendancePolicyCreateRequestDto,
  AttendancePolicyDto,
  AttendancePolicyListQueryDto,
  AttendancePolicyListResponseDto,
  AttendancePolicyUpdateRequestDto,
} from './dto/attendance-policy.dto';

type PolicyWriteFields = {
  name: string;
  mode: AttendancePolicyMode;
  geolocationRequired: boolean;
  ipAllowlist: string[];
  allowedWorkplaceIds: string[];
  autoCheckout: AttendancePolicyAutoCheckoutDto;
  status: ResourceStatus;
};

@Injectable()
export class AttendancePoliciesService {
  constructor(
    @InjectRepository(AttendancePolicyEntity)
    private readonly policyRepository: Repository<AttendancePolicyEntity>,
    @InjectRepository(WorkplaceEntity)
    private readonly workplaceRepository: Repository<WorkplaceEntity>,
  ) {}

  async list(
    tenantId: string,
    query: AttendancePolicyListQueryDto,
  ): Promise<AttendancePolicyListResponseDto> {
    const { limit, offset } = parsePageOptions(query);
    const status = parseOptionalEnumValue(
      query.status,
      ResourceStatus,
      'status',
    );
    const mode = parseOptionalEnumValue(
      query.mode,
      AttendancePolicyMode,
      'mode',
    );
    const search = parseOptionalString(query.search, 'search', 120);
    const where = this.buildListWhere(tenantId, status, mode, search);
    const [policies, totalCount] = await this.policyRepository.findAndCount({
      order: {
        createdAt: 'DESC',
        id: 'ASC',
      },
      skip: offset,
      take: limit,
      where,
    });

    return {
      data: policies.map(toAttendancePolicyDto),
      pagination: {
        nextCursor: getNextCursor(offset, policies.length, totalCount),
      },
    };
  }

  async create(
    tenantId: string,
    request: AttendancePolicyCreateRequestDto,
  ): Promise<AttendancePolicyDto> {
    const fields = this.parseCreateRequest(request);

    await this.ensureNameAvailable(tenantId, fields.name);
    await this.ensureAllowedWorkplacesBelongToTenant(
      tenantId,
      fields.allowedWorkplaceIds,
    );

    const policy = this.policyRepository.create({
      allowedWorkplaceIds: fields.allowedWorkplaceIds,
      autoCheckoutAfterMinutes: fields.autoCheckout.afterMinutes,
      autoCheckoutEnabled: fields.autoCheckout.enabled,
      geolocationRequired: fields.geolocationRequired,
      ipAllowlist: fields.ipAllowlist,
      mode: fields.mode,
      name: fields.name,
      status: fields.status,
      tenantId,
    });

    return toAttendancePolicyDto(await this.policyRepository.save(policy));
  }

  async get(tenantId: string, policyId: string): Promise<AttendancePolicyDto> {
    return toAttendancePolicyDto(await this.getEntityOrFail(tenantId, policyId));
  }

  async update(
    tenantId: string,
    policyId: string,
    request: AttendancePolicyUpdateRequestDto,
  ): Promise<AttendancePolicyDto> {
    const policy = await this.getEntityOrFail(tenantId, policyId);
    const name = parseOptionalString(request.name, 'name', 160);
    const mode = parseOptionalEnumValue(
      request.mode,
      AttendancePolicyMode,
      'mode',
    );
    const geolocationRequired =
      request.geolocationRequired === undefined
        ? undefined
        : parseBoolean(request.geolocationRequired, false);
    const ipAllowlist =
      request.ipAllowlist === undefined
        ? undefined
        : parseIpAllowlist(request.ipAllowlist);
    const allowedWorkplaceIds =
      request.allowedWorkplaceIds === undefined
        ? undefined
        : parseStringArray(request.allowedWorkplaceIds, 'allowedWorkplaceIds', 80);
    const autoCheckout =
      request.autoCheckout === undefined
        ? undefined
        : parseAutoCheckout(request.autoCheckout);
    const status = parseOptionalEnumValue(
      request.status,
      ResourceStatus,
      'status',
    );

    if (name !== undefined && name !== policy.name) {
      await this.ensureNameAvailable(tenantId, name, policy.id);
      policy.name = name;
    }

    if (mode !== undefined) {
      policy.mode = mode;
    }

    if (geolocationRequired !== undefined) {
      policy.geolocationRequired = geolocationRequired;
    }

    if (ipAllowlist !== undefined) {
      policy.ipAllowlist = ipAllowlist;
    }

    if (allowedWorkplaceIds !== undefined) {
      await this.ensureAllowedWorkplacesBelongToTenant(
        tenantId,
        allowedWorkplaceIds,
      );
      policy.allowedWorkplaceIds = allowedWorkplaceIds;
    }

    if (autoCheckout !== undefined) {
      policy.autoCheckoutEnabled = autoCheckout.enabled;
      policy.autoCheckoutAfterMinutes = autoCheckout.afterMinutes;
    }

    if (status !== undefined) {
      policy.status = status;
    }

    return toAttendancePolicyDto(await this.policyRepository.save(policy));
  }

  async delete(tenantId: string, policyId: string): Promise<void> {
    const policy = await this.getEntityOrFail(tenantId, policyId);

    policy.status = ResourceStatus.INACTIVE;
    await this.policyRepository.save(policy);
  }

  private parseCreateRequest(
    request: AttendancePolicyCreateRequestDto,
  ): PolicyWriteFields {
    return {
      allowedWorkplaceIds: parseStringArray(
        request.allowedWorkplaceIds,
        'allowedWorkplaceIds',
        80,
      ),
      autoCheckout: parseAutoCheckout(request.autoCheckout),
      geolocationRequired: parseBoolean(request.geolocationRequired, false),
      ipAllowlist: parseIpAllowlist(request.ipAllowlist),
      mode: parseEnumValue(request.mode, AttendancePolicyMode, 'mode'),
      name: parseRequiredString(request.name, 'name', 160),
      status: ResourceStatus.ACTIVE,
    };
  }

  private buildListWhere(
    tenantId: string,
    status: ResourceStatus | undefined,
    mode: AttendancePolicyMode | undefined,
    search: string | undefined,
  ):
    | FindOptionsWhere<AttendancePolicyEntity>
    | FindOptionsWhere<AttendancePolicyEntity>[] {
    const baseWhere: FindOptionsWhere<AttendancePolicyEntity> = {
      tenantId,
      ...(mode === undefined ? {} : { mode }),
      ...(status === undefined ? {} : { status }),
    };

    if (search === undefined) {
      return baseWhere;
    }

    return {
      ...baseWhere,
      name: ILike(`%${search}%`),
    };
  }

  private async getEntityOrFail(
    tenantId: string,
    policyId: string,
  ): Promise<AttendancePolicyEntity> {
    const policy = await this.policyRepository.findOneBy({
      id: policyId,
      tenantId,
    });

    if (policy === null) {
      throw new NotFoundException('Attendance policy not found.');
    }

    return policy;
  }

  private async ensureNameAvailable(
    tenantId: string,
    name: string,
    exceptPolicyId?: string,
  ): Promise<void> {
    const existingPolicy = await this.policyRepository.findOneBy({
      name,
      tenantId,
    });

    if (existingPolicy !== null && existingPolicy.id !== exceptPolicyId) {
      throw new ConflictException('Attendance policy name already exists.');
    }
  }

  private async ensureAllowedWorkplacesBelongToTenant(
    tenantId: string,
    workplaceIds: string[],
  ): Promise<void> {
    if (workplaceIds.length === 0) {
      return;
    }

    const workplaces = await this.workplaceRepository.findBy({
      id: In(workplaceIds),
      tenantId,
    });

    if (workplaces.length !== workplaceIds.length) {
      throw new NotFoundException('Allowed workplace not found.');
    }
  }
}

function parseAutoCheckout(value: unknown): AttendancePolicyAutoCheckoutDto {
  if (value === undefined || value === null) {
    return {
      afterMinutes: null,
      enabled: false,
    };
  }

  if (!isRecord(value)) {
    throw new BadRequestException('autoCheckout must be an object.');
  }

  const enabled = parseBoolean(value.enabled, false);
  const afterMinutes = parseAutoCheckoutAfterMinutes(value.afterMinutes, enabled);

  return {
    afterMinutes,
    enabled,
  };
}

function parseAutoCheckoutAfterMinutes(
  value: unknown,
  enabled: boolean,
): number | null {
  if (value === undefined || value === null || value === '') {
    if (enabled) {
      throw new BadRequestException(
        'autoCheckout.afterMinutes is required when auto-checkout is enabled.',
      );
    }

    return null;
  }

  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue < 1 || parsedValue > 1440) {
    throw new BadRequestException(
      'autoCheckout.afterMinutes must be between 1 and 1440.',
    );
  }

  return parsedValue;
}

function parseIpAllowlist(value: unknown): string[] {
  return parseStringArray(value, 'ipAllowlist', 128).map((entry) => {
    if (!isIpOrCidr(entry)) {
      throw new BadRequestException('ipAllowlist must contain IPs or CIDR ranges.');
    }

    return entry;
  });
}

function parseStringArray(
  value: unknown,
  name: string,
  maxLength: number,
): string[] {
  if (value === undefined || value === null || value === '') {
    return [];
  }

  const rawValues = Array.isArray(value) ? value : [value];
  const values = rawValues.map((item) =>
    parseRequiredString(item, name, maxLength),
  );

  return [...new Set(values)];
}

function isIpOrCidr(value: string): boolean {
  const parts = value.split('/');
  const [ipAddress, prefixLength] = parts;

  if (parts.length > 2) {
    return false;
  }

  const ipVersion = isIP(ipAddress ?? '');

  if (ipVersion === 0) {
    return false;
  }

  if (prefixLength === undefined) {
    return true;
  }

  const parsedPrefix = Number(prefixLength);
  const maxPrefix = ipVersion === 4 ? 32 : 128;

  return (
    Number.isInteger(parsedPrefix) &&
    parsedPrefix >= 0 &&
    parsedPrefix <= maxPrefix
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
