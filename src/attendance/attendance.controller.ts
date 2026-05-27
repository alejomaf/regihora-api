import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../domain/enums';
import { CurrentTenant } from '../tenancy/decorators/current-tenant.decorator';
import { TenantGuard } from '../tenancy/guards/tenant.guard';
import type { CurrentTenantContext } from '../tenancy/types/current-tenant';
import { AttendanceService } from './attendance.service';
import {
  AttendancePunchCreateRequestDto,
  AttendancePunchDto,
} from './dto/attendance-punch.dto';

@Controller('v1/attendance')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post('punch')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)
  punch(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() request: AttendancePunchCreateRequestDto,
    @Req() httpRequest: Request,
  ): Promise<AttendancePunchDto> {
    return this.attendanceService.punch(request, {
      currentTenant: tenant,
      idempotencyKey: parseIdempotencyKey(idempotencyKey),
      ipAddress: httpRequest.ip ?? httpRequest.socket.remoteAddress ?? null,
      userAgent: getHeaderValue(httpRequest.headers['user-agent']),
    });
  }
}

function parseIdempotencyKey(value: string | undefined): string {
  if (value === undefined) {
    throw new BadRequestException('Idempotency-Key is required.');
  }

  const idempotencyKey = value.trim();

  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    throw new BadRequestException('Idempotency-Key must be between 8 and 128 characters.');
  }

  return idempotencyKey;
}

function getHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}
