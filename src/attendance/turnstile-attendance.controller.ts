import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { AttendanceService } from './attendance.service';
import {
  AttendancePunchDto,
  TurnstilePunchCreateRequestDto,
} from './dto/attendance-punch.dto';

@Controller('v1/devices/qr')
export class TurnstileAttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post(':qrDeviceId/turnstile-punch')
  @HttpCode(HttpStatus.CREATED)
  turnstilePunch(
    @Param('qrDeviceId') qrDeviceId: string,
    @Headers('x-regihora-device-token') deviceToken: string | string[] | undefined,
    @Body() request: TurnstilePunchCreateRequestDto,
    @Req() httpRequest: Request,
  ): Promise<AttendancePunchDto> {
    return this.attendanceService.turnstilePunch(
      qrDeviceId,
      parseDeviceTokenHeader(deviceToken),
      request,
      {
        ipAddress: httpRequest.ip ?? httpRequest.socket.remoteAddress ?? null,
        userAgent: getHeaderValue(httpRequest.headers['user-agent']),
      },
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

function getHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}
