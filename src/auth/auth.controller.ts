import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Request } from 'express';

import { AuthService } from './auth.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginRequestDto } from './dto/login-request.dto';
import { LogoutRequestDto } from './dto/logout-request.dto';
import { RefreshTokenRequestDto } from './dto/refresh-token-request.dto';
import { RequestAuthContext } from './types/authenticated-principal';

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(
    @Body() request: LoginRequestDto,
    @Req() httpRequest: Request,
  ): Promise<AuthResponseDto> {
    return this.authService.login(request, getRequestAuthContext(httpRequest));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(
    @Body() request: RefreshTokenRequestDto,
    @Req() httpRequest: Request,
  ): Promise<AuthResponseDto> {
    return this.authService.refresh(request, getRequestAuthContext(httpRequest));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Body() request: LogoutRequestDto): Promise<void> {
    return this.authService.logout(request);
  }
}

function getRequestAuthContext(request: Request): RequestAuthContext {
  return {
    ipAddress: request.ip ?? request.socket.remoteAddress ?? null,
    userAgent: getHeaderValue(request.headers['user-agent']),
  };
}

function getHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

