import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';

import { WorkplaceEntity } from '../../database/entities/workplace.entity';
import { ResourceStatus, WorkMode } from '../../domain/enums';
import { toWorkplaceDto } from '../common/mappers';
import {
  getNextCursor,
  parseOptionalEnumValue,
  parseOptionalString,
  parsePageOptions,
  parseRequiredString,
  parseEnumValue,
} from '../common/request-parsing';
import {
  ListQueryDto,
  PaginatedResponseDto,
  WorkplaceCreateRequestDto,
  WorkplaceDto,
  WorkplaceUpdateRequestDto,
} from '../dto/organization.dto';

@Injectable()
export class WorkplacesService {
  constructor(
    @InjectRepository(WorkplaceEntity)
    private readonly workplaceRepository: Repository<WorkplaceEntity>,
  ) {}

  async list(
    tenantId: string,
    query: ListQueryDto,
  ): Promise<PaginatedResponseDto<WorkplaceDto>> {
    const { limit, offset } = parsePageOptions(query);
    const status = parseOptionalEnumValue(
      query.status,
      ResourceStatus,
      'status',
    );
    const search = parseOptionalString(query.search, 'search', 120);
    const where = this.buildListWhere(tenantId, status, search);
    const [workplaces, totalCount] = await this.workplaceRepository.findAndCount({
      order: {
        createdAt: 'DESC',
        id: 'ASC',
      },
      skip: offset,
      take: limit,
      where,
    });

    return {
      data: workplaces.map(toWorkplaceDto),
      pagination: {
        nextCursor: getNextCursor(offset, workplaces.length, totalCount),
      },
    };
  }

  async create(
    tenantId: string,
    request: WorkplaceCreateRequestDto,
  ): Promise<WorkplaceDto> {
    const name = parseRequiredString(request.name, 'name', 160);
    const mode = parseEnumValue(request.type, WorkMode, 'type');
    const timezone =
      parseOptionalString(request.timezone, 'timezone', 64) ?? 'Europe/Madrid';

    validateTimezone(timezone);
    await this.ensureNameAvailable(tenantId, name);

    const workplace = this.workplaceRepository.create({
      mode,
      name,
      status: ResourceStatus.ACTIVE,
      tenantId,
      timezone,
    });

    return toWorkplaceDto(await this.workplaceRepository.save(workplace));
  }

  async get(tenantId: string, workplaceId: string): Promise<WorkplaceDto> {
    return toWorkplaceDto(await this.getEntityOrFail(tenantId, workplaceId));
  }

  async update(
    tenantId: string,
    workplaceId: string,
    request: WorkplaceUpdateRequestDto,
  ): Promise<WorkplaceDto> {
    const workplace = await this.getEntityOrFail(tenantId, workplaceId);
    const name = parseOptionalString(request.name, 'name', 160);
    const mode = parseOptionalEnumValue(request.type, WorkMode, 'type');
    const timezone = parseOptionalString(request.timezone, 'timezone', 64);
    const status = parseOptionalEnumValue(
      request.status,
      ResourceStatus,
      'status',
    );

    if (name !== undefined && name !== workplace.name) {
      await this.ensureNameAvailable(tenantId, name, workplace.id);
      workplace.name = name;
    }

    if (mode !== undefined) {
      workplace.mode = mode;
    }

    if (timezone !== undefined) {
      validateTimezone(timezone);
      workplace.timezone = timezone;
    }

    if (status !== undefined) {
      workplace.status = status;
    }

    return toWorkplaceDto(await this.workplaceRepository.save(workplace));
  }

  async delete(tenantId: string, workplaceId: string): Promise<void> {
    const workplace = await this.getEntityOrFail(tenantId, workplaceId);

    workplace.status = ResourceStatus.INACTIVE;
    await this.workplaceRepository.save(workplace);
  }

  private buildListWhere(
    tenantId: string,
    status: ResourceStatus | undefined,
    search: string | undefined,
  ): FindOptionsWhere<WorkplaceEntity> | FindOptionsWhere<WorkplaceEntity>[] {
    const baseWhere: FindOptionsWhere<WorkplaceEntity> = {
      tenantId,
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
    workplaceId: string,
  ): Promise<WorkplaceEntity> {
    const workplace = await this.workplaceRepository.findOneBy({
      id: workplaceId,
      tenantId,
    });

    if (workplace === null) {
      throw new NotFoundException('Workplace not found.');
    }

    return workplace;
  }

  private async ensureNameAvailable(
    tenantId: string,
    name: string,
    exceptWorkplaceId?: string,
  ): Promise<void> {
    const existingWorkplace = await this.workplaceRepository.findOneBy({
      name: ILike(name),
      tenantId,
    });

    if (
      existingWorkplace !== null &&
      existingWorkplace.id !== exceptWorkplaceId
    ) {
      throw new ConflictException('Workplace name already exists.');
    }
  }
}

function validateTimezone(timezone: string): void {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
  } catch {
    throw new BadRequestException('timezone must be a valid IANA timezone.');
  }
}
