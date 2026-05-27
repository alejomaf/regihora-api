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
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { AuthenticatedPrincipal } from '../../auth/types/authenticated-principal';
import { UserRole } from '../../domain/enums';
import { CurrentTenant } from '../../tenancy/decorators/current-tenant.decorator';
import { TenantGuard } from '../../tenancy/guards/tenant.guard';
import { CurrentTenantContext } from '../../tenancy/types/current-tenant';
import {
  EmployeeCreateRequestDto,
  EmployeeCsvImportRequestDto,
  EmployeeCsvImportResponseDto,
  EmployeeDto,
  EmployeeInvitationDto,
  EmployeeUpdateRequestDto,
  ListQueryDto,
  PaginatedResponseDto,
} from '../dto/organization.dto';
import { EmployeesService } from './employees.service';

@Controller('v1/employees')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Get()
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN, UserRole.MANAGER, UserRole.AUDITOR)
  list(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Query() query: ListQueryDto,
  ): Promise<PaginatedResponseDto<EmployeeDto>> {
    return this.employeesService.list(tenant.tenantId, query);
  }

  @Post()
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN)
  create(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Body() request: EmployeeCreateRequestDto,
  ): Promise<EmployeeDto> {
    return this.employeesService.create(tenant, request);
  }

  @Post('imports')
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN)
  importCsv(
    @CurrentAuth() auth: AuthenticatedPrincipal,
    @CurrentTenant() tenant: CurrentTenantContext,
    @Body() request: EmployeeCsvImportRequestDto | string,
  ): Promise<EmployeeCsvImportResponseDto> {
    return this.employeesService.importCsv(
      tenant.tenantId,
      request,
      auth.sub,
      tenant.employeeId,
    );
  }

  @Get(':employeeId')
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN, UserRole.MANAGER, UserRole.AUDITOR)
  get(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Param('employeeId') employeeId: string,
  ): Promise<EmployeeDto> {
    return this.employeesService.get(tenant.tenantId, employeeId);
  }

  @Patch(':employeeId')
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN)
  update(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Param('employeeId') employeeId: string,
    @Body() request: EmployeeUpdateRequestDto,
  ): Promise<EmployeeDto> {
    return this.employeesService.update(tenant, employeeId, request);
  }

  @Delete(':employeeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN)
  delete(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Param('employeeId') employeeId: string,
  ): Promise<void> {
    return this.employeesService.delete(tenant, employeeId);
  }

  @Post(':employeeId/invite')
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN)
  invite(
    @CurrentAuth() auth: AuthenticatedPrincipal,
    @CurrentTenant() tenant: CurrentTenantContext,
    @Param('employeeId') employeeId: string,
  ): Promise<EmployeeInvitationDto> {
    return this.employeesService.invite(
      tenant.tenantId,
      employeeId,
      auth.sub,
      tenant.employeeId,
    );
  }
}
