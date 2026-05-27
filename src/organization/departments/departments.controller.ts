import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UserRole } from '../../domain/enums';
import { CurrentTenant } from '../../tenancy/decorators/current-tenant.decorator';
import { TenantGuard } from '../../tenancy/guards/tenant.guard';
import { CurrentTenantContext } from '../../tenancy/types/current-tenant';
import {
  DepartmentCreateRequestDto,
  DepartmentDto,
  DepartmentUpdateRequestDto,
  ListQueryDto,
  PaginatedResponseDto,
} from '../dto/organization.dto';
import { DepartmentsService } from './departments.service';

@Controller('v1/departments')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Get()
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN, UserRole.MANAGER, UserRole.AUDITOR)
  list(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Query() query: ListQueryDto,
  ): Promise<PaginatedResponseDto<DepartmentDto>> {
    return this.departmentsService.list(tenant.tenantId, query);
  }

  @Post()
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN)
  create(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Body() request: DepartmentCreateRequestDto,
  ): Promise<DepartmentDto> {
    return this.departmentsService.create(tenant.tenantId, request);
  }

  @Get(':departmentId')
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN, UserRole.MANAGER, UserRole.AUDITOR)
  get(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Param('departmentId') departmentId: string,
  ): Promise<DepartmentDto> {
    return this.departmentsService.get(tenant.tenantId, departmentId);
  }

  @Patch(':departmentId')
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN)
  update(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Param('departmentId') departmentId: string,
    @Body() request: DepartmentUpdateRequestDto,
  ): Promise<DepartmentDto> {
    return this.departmentsService.update(tenant.tenantId, departmentId, request);
  }

  @Delete(':departmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN)
  delete(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Param('departmentId') departmentId: string,
  ): Promise<void> {
    return this.departmentsService.delete(tenant.tenantId, departmentId);
  }
}
