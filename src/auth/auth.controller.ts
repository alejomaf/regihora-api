import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';

import { CurrentAuth } from './decorators/current-auth.decorator';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthResponseDto, AuthSessionListResponseDto } from './dto/auth-response.dto';
import { LoginRequestDto } from './dto/login-request.dto';
import { LogoutRequestDto } from './dto/logout-request.dto';
import { OwnerRegistrationRequestDto } from './dto/owner-registration-request.dto';
import { RefreshTokenRequestDto } from './dto/refresh-token-request.dto';
import {
  AuthenticatedPrincipal,
  RequestAuthContext,
} from './types/authenticated-principal';

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

  @Post('register-owner')
  registerOwner(
    @Body() request: OwnerRegistrationRequestDto,
    @Req() httpRequest: Request,
  ): Promise<AuthResponseDto> {
    return this.authService.registerOwner(
      request,
      getRequestAuthContext(httpRequest),
    );
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

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  listSessions(
    @CurrentAuth() auth: AuthenticatedPrincipal,
  ): Promise<AuthSessionListResponseDto> {
    return this.authService.listSessions(auth);
  }

  @Post('sessions/revoke-others')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  revokeOtherSessions(
    @CurrentAuth() auth: AuthenticatedPrincipal,
  ): Promise<AuthSessionListResponseDto> {
    return this.authService.revokeOtherSessions(auth);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  revokeSession(
    @CurrentAuth() auth: AuthenticatedPrincipal,
    @Param('sessionId') sessionId: string,
  ): Promise<void> {
    return this.authService.revokeSession(auth, sessionId);
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
