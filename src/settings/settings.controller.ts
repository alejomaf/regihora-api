import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../domain/enums';
import { CurrentTenant } from '../tenancy/decorators/current-tenant.decorator';
import { TenantGuard } from '../tenancy/guards/tenant.guard';
import type { CurrentTenantContext } from '../tenancy/types/current-tenant';
import {
  SecuritySettingsDto,
  SecuritySettingsUpdateRequestDto,
} from './dto/security-settings.dto';
import { SettingsService } from './settings.service';

@Controller('v1/settings')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('security')
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN, UserRole.MANAGER, UserRole.AUDITOR)
  getSecuritySettings(
    @CurrentTenant() tenant: CurrentTenantContext,
  ): Promise<SecuritySettingsDto> {
    return this.settingsService.getSecuritySettings(tenant.tenantId);
  }

  @Patch('security')
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN)
  updateSecuritySettings(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Body() request: SecuritySettingsUpdateRequestDto,
  ): Promise<SecuritySettingsDto> {
    return this.settingsService.updateSecuritySettings(tenant.tenantId, request);
  }
}
