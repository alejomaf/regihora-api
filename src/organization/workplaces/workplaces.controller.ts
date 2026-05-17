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

import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UserRole } from '../../domain/enums';
import { CurrentTenant } from '../../tenancy/decorators/current-tenant.decorator';
import { TenantGuard } from '../../tenancy/guards/tenant.guard';
import { CurrentTenantContext } from '../../tenancy/types/current-tenant';
import {
  ListQueryDto,
  PaginatedResponseDto,
  WorkplaceCreateRequestDto,
  WorkplaceDto,
  WorkplaceUpdateRequestDto,
} from '../dto/organization.dto';
import { WorkplacesService } from './workplaces.service';

@Controller('v1/workplaces')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class WorkplacesController {
  constructor(private readonly workplacesService: WorkplacesService) {}

  @Get()
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN, UserRole.MANAGER, UserRole.AUDITOR)
  list(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Query() query: ListQueryDto,
  ): Promise<PaginatedResponseDto<WorkplaceDto>> {
    return this.workplacesService.list(tenant.tenantId, query);
  }

  @Post()
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN, UserRole.MANAGER)
  create(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Body() request: WorkplaceCreateRequestDto,
  ): Promise<WorkplaceDto> {
    return this.workplacesService.create(tenant.tenantId, request);
  }

  @Get(':workplaceId')
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN, UserRole.MANAGER, UserRole.AUDITOR)
  get(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Param('workplaceId') workplaceId: string,
  ): Promise<WorkplaceDto> {
    return this.workplacesService.get(tenant.tenantId, workplaceId);
  }

  @Patch(':workplaceId')
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN, UserRole.MANAGER)
  update(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Param('workplaceId') workplaceId: string,
    @Body() request: WorkplaceUpdateRequestDto,
  ): Promise<WorkplaceDto> {
    return this.workplacesService.update(tenant.tenantId, workplaceId, request);
  }

  @Delete(':workplaceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN, UserRole.MANAGER)
  delete(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Param('workplaceId') workplaceId: string,
  ): Promise<void> {
    return this.workplacesService.delete(tenant.tenantId, workplaceId);
  }
}
