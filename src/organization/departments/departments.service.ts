import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';

import { DepartmentEntity } from '../../database/entities/department.entity';
import { ResourceStatus } from '../../domain/enums';
import {
  getNextCursor,
  parseOptionalEnumValue,
  parseOptionalString,
  parsePageOptions,
  parseRequiredString,
} from '../common/request-parsing';
import { toDepartmentDto } from '../common/mappers';
import {
  DepartmentCreateRequestDto,
  DepartmentDto,
  DepartmentUpdateRequestDto,
  ListQueryDto,
  PaginatedResponseDto,
} from '../dto/organization.dto';

@Injectable()
export class DepartmentsService {
  constructor(
    @InjectRepository(DepartmentEntity)
    private readonly departmentRepository: Repository<DepartmentEntity>,
  ) {}

  async list(
    tenantId: string,
    query: ListQueryDto,
  ): Promise<PaginatedResponseDto<DepartmentDto>> {
    const { limit, offset } = parsePageOptions(query);
    const status = parseOptionalEnumValue(
      query.status,
      ResourceStatus,
      'status',
    );
    const search = parseOptionalString(query.search, 'search', 120);
    const where = this.buildListWhere(tenantId, status, search);
    const [departments, totalCount] = await this.departmentRepository.findAndCount({
      order: {
        createdAt: 'DESC',
        id: 'ASC',
      },
      skip: offset,
      take: limit,
      where,
    });

    return {
      data: departments.map(toDepartmentDto),
      pagination: {
        nextCursor: getNextCursor(offset, departments.length, totalCount),
      },
    };
  }

  async create(
    tenantId: string,
    request: DepartmentCreateRequestDto,
  ): Promise<DepartmentDto> {
    const name = parseRequiredString(request.name, 'name', 160);

    await this.ensureNameAvailable(tenantId, name);

    const department = this.departmentRepository.create({
      name,
      status: ResourceStatus.ACTIVE,
      tenantId,
    });

    return toDepartmentDto(await this.departmentRepository.save(department));
  }

  async get(tenantId: string, departmentId: string): Promise<DepartmentDto> {
    return toDepartmentDto(await this.getEntityOrFail(tenantId, departmentId));
  }

  async update(
    tenantId: string,
    departmentId: string,
    request: DepartmentUpdateRequestDto,
  ): Promise<DepartmentDto> {
    const department = await this.getEntityOrFail(tenantId, departmentId);
    const name = parseOptionalString(request.name, 'name', 160);
    const status = parseOptionalEnumValue(
      request.status,
      ResourceStatus,
      'status',
    );

    if (name !== undefined && name !== department.name) {
      await this.ensureNameAvailable(tenantId, name, department.id);
      department.name = name;
    }

    if (status !== undefined) {
      department.status = status;
    }

    return toDepartmentDto(await this.departmentRepository.save(department));
  }

  async delete(tenantId: string, departmentId: string): Promise<void> {
    const department = await this.getEntityOrFail(tenantId, departmentId);

    department.status = ResourceStatus.INACTIVE;
    await this.departmentRepository.save(department);
  }

  private buildListWhere(
    tenantId: string,
    status: ResourceStatus | undefined,
    search: string | undefined,
  ): FindOptionsWhere<DepartmentEntity> | FindOptionsWhere<DepartmentEntity>[] {
    const baseWhere: FindOptionsWhere<DepartmentEntity> = {
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
    departmentId: string,
  ): Promise<DepartmentEntity> {
    const department = await this.departmentRepository.findOneBy({
      id: departmentId,
      tenantId,
    });

    if (department === null) {
      throw new NotFoundException('Department not found.');
    }

    return department;
  }

  private async ensureNameAvailable(
    tenantId: string,
    name: string,
    exceptDepartmentId?: string,
  ): Promise<void> {
    const existingDepartment = await this.departmentRepository.findOneBy({
      name,
      tenantId,
    });

    if (
      existingDepartment !== null &&
      existingDepartment.id !== exceptDepartmentId
    ) {
      throw new ConflictException('Department name already exists.');
    }
  }
}
