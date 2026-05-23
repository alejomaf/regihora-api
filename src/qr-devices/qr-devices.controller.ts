import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../domain/enums';
import { CurrentTenant } from '../tenancy/decorators/current-tenant.decorator';
import { TenantGuard } from '../tenancy/guards/tenant.guard';
import type { CurrentTenantContext } from '../tenancy/types/current-tenant';
import {
  QrChallengeDto,
  QrDeviceCreateRequestDto,
  QrDeviceDto,
  QrDeviceEnrollmentDto,
  QrDeviceEnrollmentTokenDto,
  QrDeviceEnrollRequestDto,
  QrDeviceHeartbeatDto,
  QrDeviceListQueryDto,
  QrDeviceListResponseDto,
  QrDeviceUpdateRequestDto,
} from './dto/qr-device.dto';
import { QrDevicesService } from './qr-devices.service';

@Controller('v1/devices/qr')
export class QrDevicesController {
  constructor(private readonly qrDevicesService: QrDevicesService) {}

  @Get()
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN, UserRole.MANAGER, UserRole.AUDITOR)
  list(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Query() query: QrDeviceListQueryDto,
  ): Promise<QrDeviceListResponseDto> {
    return this.qrDevicesService.list(tenant.tenantId, query);
  }

  @Post()
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN, UserRole.MANAGER)
  create(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Body() request: QrDeviceCreateRequestDto,
  ): Promise<QrDeviceDto> {
    return this.qrDevicesService.create(tenant.tenantId, request);
  }

  @Post('enroll')
  @HttpCode(HttpStatus.OK)
  enroll(
    @Body() request: QrDeviceEnrollRequestDto,
  ): Promise<QrDeviceEnrollmentDto> {
    return this.qrDevicesService.enroll(request);
  }

  @Get(':qrDeviceId')
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN, UserRole.MANAGER, UserRole.AUDITOR)
  get(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Param('qrDeviceId') qrDeviceId: string,
  ): Promise<QrDeviceDto> {
    return this.qrDevicesService.get(tenant.tenantId, qrDeviceId);
  }

  @Patch(':qrDeviceId')
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN, UserRole.MANAGER)
  update(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Param('qrDeviceId') qrDeviceId: string,
    @Body() request: QrDeviceUpdateRequestDto,
  ): Promise<QrDeviceDto> {
    return this.qrDevicesService.update(tenant.tenantId, qrDeviceId, request);
  }

  @Post(':qrDeviceId/enrollment-token')
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN, UserRole.MANAGER)
  createEnrollmentToken(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Param('qrDeviceId') qrDeviceId: string,
  ): Promise<QrDeviceEnrollmentTokenDto> {
    return this.qrDevicesService.createEnrollmentToken(
      tenant.tenantId,
      qrDeviceId,
    );
  }

  @Post(':qrDeviceId/revoke')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN, UserRole.MANAGER)
  revoke(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Param('qrDeviceId') qrDeviceId: string,
  ): Promise<QrDeviceDto> {
    return this.qrDevicesService.revoke(tenant.tenantId, qrDeviceId);
  }

  @Post(':qrDeviceId/heartbeat')
  @HttpCode(HttpStatus.OK)
  heartbeat(
    @Param('qrDeviceId') qrDeviceId: string,
    @Headers('x-regihora-device-token') deviceToken: string | string[] | undefined,
  ): Promise<QrDeviceHeartbeatDto> {
    return this.qrDevicesService.heartbeat(
      qrDeviceId,
      parseDeviceTokenHeader(deviceToken),
    );
  }

  @Post(':qrDeviceId/challenge')
  createChallenge(
    @Param('qrDeviceId') qrDeviceId: string,
    @Headers('x-regihora-device-token') deviceToken: string | string[] | undefined,
  ): Promise<QrChallengeDto> {
    return this.qrDevicesService.createChallenge(
      qrDeviceId,
      parseDeviceTokenHeader(deviceToken),
    );
  }
}

function parseDeviceTokenHeader(value: string | string[] | undefined): string {
  const token = Array.isArray(value) ? value[0] : value;

  if (token === undefined || token.trim().length === 0) {
    throw new UnauthorizedException('Missing device token.');
  }

  return token;
}
