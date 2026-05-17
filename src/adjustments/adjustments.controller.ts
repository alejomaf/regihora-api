import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../domain/enums';
import { CurrentTenant } from '../tenancy/decorators/current-tenant.decorator';
import { TenantGuard } from '../tenancy/guards/tenant.guard';
import type { CurrentTenantContext } from '../tenancy/types/current-tenant';
import { AdjustmentsService } from './adjustments.service';
import {
  AdjustmentDecisionRequestDto,
  AttendanceAdjustmentCreateRequestDto,
  AttendanceAdjustmentDto,
  AttendanceAdjustmentListQueryDto,
  AttendanceAdjustmentListResponseDto,
} from './dto/adjustment.dto';

@Controller('v1/attendance/adjustments')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class AdjustmentsController {
  constructor(private readonly adjustmentsService: AdjustmentsService) {}

  @Get()
  @Roles(UserRole.EMPLOYEE, UserRole.MANAGER, UserRole.HR_ADMIN, UserRole.OWNER, UserRole.AUDITOR)
  list(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Query() query: AttendanceAdjustmentListQueryDto,
  ): Promise<AttendanceAdjustmentListResponseDto> {
    return this.adjustmentsService.list(tenant, query);
  }

  @Post()
  @Roles(UserRole.EMPLOYEE, UserRole.MANAGER, UserRole.HR_ADMIN, UserRole.OWNER)
  create(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Body() request: AttendanceAdjustmentCreateRequestDto,
  ): Promise<AttendanceAdjustmentDto> {
    return this.adjustmentsService.create(tenant, request);
  }

  @Get(':adjustmentId')
  @Roles(UserRole.EMPLOYEE, UserRole.MANAGER, UserRole.HR_ADMIN, UserRole.OWNER, UserRole.AUDITOR)
  get(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Param('adjustmentId') adjustmentId: string,
  ): Promise<AttendanceAdjustmentDto> {
    return this.adjustmentsService.get(tenant, adjustmentId);
  }

  @Post(':adjustmentId/approve')
  @Roles(UserRole.MANAGER, UserRole.HR_ADMIN, UserRole.OWNER)
  approve(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Param('adjustmentId') adjustmentId: string,
    @Body() request: AdjustmentDecisionRequestDto = {},
  ): Promise<AttendanceAdjustmentDto> {
    return this.adjustmentsService.approve(tenant, adjustmentId, request);
  }

  @Post(':adjustmentId/reject')
  @Roles(UserRole.MANAGER, UserRole.HR_ADMIN, UserRole.OWNER)
  reject(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Param('adjustmentId') adjustmentId: string,
    @Body() request: AdjustmentDecisionRequestDto,
  ): Promise<AttendanceAdjustmentDto> {
    return this.adjustmentsService.reject(tenant, adjustmentId, request);
  }
}
