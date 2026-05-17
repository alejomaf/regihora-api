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

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../domain/enums';
import { CurrentTenant } from '../tenancy/decorators/current-tenant.decorator';
import { TenantGuard } from '../tenancy/guards/tenant.guard';
import type { CurrentTenantContext } from '../tenancy/types/current-tenant';
import { AttendancePoliciesService } from './attendance-policies.service';
import {
  AttendancePolicyCreateRequestDto,
  AttendancePolicyDto,
  AttendancePolicyListQueryDto,
  AttendancePolicyListResponseDto,
  AttendancePolicyUpdateRequestDto,
} from './dto/attendance-policy.dto';

@Controller('v1/attendance-policies')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class AttendancePoliciesController {
  constructor(
    private readonly attendancePoliciesService: AttendancePoliciesService,
  ) {}

  @Get()
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN, UserRole.MANAGER, UserRole.AUDITOR)
  list(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Query() query: AttendancePolicyListQueryDto,
  ): Promise<AttendancePolicyListResponseDto> {
    return this.attendancePoliciesService.list(tenant.tenantId, query);
  }

  @Post()
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN, UserRole.MANAGER)
  create(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Body() request: AttendancePolicyCreateRequestDto,
  ): Promise<AttendancePolicyDto> {
    return this.attendancePoliciesService.create(tenant.tenantId, request);
  }

  @Get(':attendancePolicyId')
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN, UserRole.MANAGER, UserRole.AUDITOR)
  get(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Param('attendancePolicyId') attendancePolicyId: string,
  ): Promise<AttendancePolicyDto> {
    return this.attendancePoliciesService.get(
      tenant.tenantId,
      attendancePolicyId,
    );
  }

  @Patch(':attendancePolicyId')
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN, UserRole.MANAGER)
  update(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Param('attendancePolicyId') attendancePolicyId: string,
    @Body() request: AttendancePolicyUpdateRequestDto,
  ): Promise<AttendancePolicyDto> {
    return this.attendancePoliciesService.update(
      tenant.tenantId,
      attendancePolicyId,
      request,
    );
  }

  @Delete(':attendancePolicyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN, UserRole.MANAGER)
  delete(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Param('attendancePolicyId') attendancePolicyId: string,
  ): Promise<void> {
    return this.attendancePoliciesService.delete(
      tenant.tenantId,
      attendancePolicyId,
    );
  }
}
