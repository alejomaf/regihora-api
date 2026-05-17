import { randomBytes, randomUUID } from 'node:crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';

import { EnvironmentVariables } from '../config/environment.validation';
import { EmployeeStatus, UserRole } from '../domain/enums';
import { EmployeeEntity } from '../database/entities/employee.entity';
import { SessionEntity } from '../database/entities/session.entity';
import { UserEntity } from '../database/entities/user.entity';
import { AuthResponseDto, AuthMembershipDto } from './dto/auth-response.dto';
import { LoginRequestDto } from './dto/login-request.dto';
import { RefreshTokenRequestDto } from './dto/refresh-token-request.dto';
import { PasswordHasher } from './password/password-hasher.service';
import { RequestAuthContext } from './types/authenticated-principal';

type RefreshTokenParts = {
  sessionId: string;
  secret: string;
};

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(SessionEntity)
    private readonly sessionRepository: Repository<SessionEntity>,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
    private readonly jwtService: JwtService,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async login(
    request: LoginRequestDto,
    context: RequestAuthContext,
  ): Promise<AuthResponseDto> {
    const email = this.parseEmail(request.email);
    const password = this.parseNonEmptyString(request.password, 'password');
    const user = await this.findActiveUserByEmail(email);

    if (user === null) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const passwordHash = user.passwordHash;

    if (passwordHash === null) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const validPassword = await this.passwordHasher.verify(passwordHash, password);

    if (!validPassword) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    return this.createSessionResponse(user, context);
  }

  async refresh(
    request: RefreshTokenRequestDto,
    context: RequestAuthContext,
  ): Promise<AuthResponseDto> {
    const refreshToken = this.parseNonEmptyString(
      request.refreshToken,
      'refreshToken',
    );
    const tokenParts = this.parseRefreshToken(refreshToken);
    const session = await this.sessionRepository.findOne({
      relations: {
        user: {
          employees: true,
        },
      },
      where: {
        expiresAt: MoreThan(new Date()),
        id: tokenParts.sessionId,
        revokedAt: IsNull(),
      },
    });

    if (
      session === null ||
      !(await this.passwordHasher.verify(session.refreshTokenHash, tokenParts.secret))
    ) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    session.revokedAt = new Date();
    session.lastUsedAt = session.revokedAt;
    await this.sessionRepository.save(session);

    if (!session.user.isActive) {
      throw new UnauthorizedException('User is inactive.');
    }

    return this.createSessionResponse(session.user, context);
  }

  async logout(request: RefreshTokenRequestDto): Promise<void> {
    const refreshToken = this.parseNonEmptyString(
      request.refreshToken,
      'refreshToken',
    );
    const tokenParts = this.parseRefreshToken(refreshToken);
    const session = await this.sessionRepository.findOne({
      where: {
        id: tokenParts.sessionId,
        revokedAt: IsNull(),
      },
    });

    if (session === null) {
      return;
    }

    if (
      !(await this.passwordHasher.verify(session.refreshTokenHash, tokenParts.secret))
    ) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    session.revokedAt = new Date();
    session.lastUsedAt = session.revokedAt;
    await this.sessionRepository.save(session);
  }

  private async findActiveUserByEmail(email: string): Promise<UserEntity | null> {
    return this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.employees', 'employee')
      .where('LOWER(user.email) = :email', { email })
      .andWhere('user.is_active = true')
      .getOne();
  }

  private async createSessionResponse(
    user: UserEntity,
    context: RequestAuthContext,
  ): Promise<AuthResponseDto> {
    const memberships = this.getActiveMemberships(user.employees);
    const accessTokenTtlSeconds = this.configService.get(
      'JWT_ACCESS_TOKEN_TTL_SECONDS',
      { infer: true },
    );
    const expiresAt = new Date(Date.now() + accessTokenTtlSeconds * 1_000);
    const accessToken = await this.jwtService.signAsync(
      {
        email: user.email,
        memberships,
        roles: this.getFlattenedRoles(memberships),
        sub: user.id,
      },
      {
        audience: this.configService.get('JWT_AUDIENCE', { infer: true }),
        expiresIn: accessTokenTtlSeconds,
        issuer: this.configService.get('JWT_ISSUER', { infer: true }),
        secret: this.configService.get('JWT_ACCESS_TOKEN_SECRET', { infer: true }),
      },
    );
    const refreshToken = await this.createRefreshToken(user.id, context);

    return {
      accessToken,
      expiresAt: expiresAt.toISOString(),
      memberships,
      refreshToken,
      tokenType: 'Bearer',
      user: {
        createdAt: user.createdAt.toISOString(),
        displayName: user.displayName,
        email: user.email,
        id: user.id,
      },
    };
  }

  private async createRefreshToken(
    userId: string,
    context: RequestAuthContext,
  ): Promise<string> {
    const sessionId = randomUUID();
    const secret = randomBytes(48).toString('base64url');
    const expiresAt = new Date(
      Date.now() +
        this.configService.get('JWT_REFRESH_TOKEN_TTL_SECONDS', { infer: true }) *
          1_000,
    );
    const session = this.sessionRepository.create({
      expiresAt,
      id: sessionId,
      ipAddress: context.ipAddress,
      refreshTokenHash: await this.passwordHasher.hash(secret),
      userAgent: context.userAgent,
      userId,
    });

    await this.sessionRepository.save(session);

    return `${sessionId}.${secret}`;
  }

  private getActiveMemberships(employees: EmployeeEntity[]): AuthMembershipDto[] {
    return employees
      .filter((employee) => employee.status !== EmployeeStatus.INACTIVE)
      .map((employee) => ({
        employeeId: employee.id,
        roles: employee.roles,
        tenantId: employee.tenantId,
      }));
  }

  private getFlattenedRoles(memberships: AuthMembershipDto[]): UserRole[] {
    return [...new Set(memberships.flatMap((membership) => membership.roles))];
  }

  private parseRefreshToken(refreshToken: string): RefreshTokenParts {
    const separatorIndex = refreshToken.indexOf('.');

    if (separatorIndex <= 0 || separatorIndex === refreshToken.length - 1) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    return {
      secret: refreshToken.slice(separatorIndex + 1),
      sessionId: refreshToken.slice(0, separatorIndex),
    };
  }

  private parseEmail(value: unknown): string {
    const email = this.parseNonEmptyString(value, 'email').toLowerCase();

    if (!email.includes('@')) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    return email;
  }

  private parseNonEmptyString(value: unknown, name: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new UnauthorizedException(`${name} is required.`);
    }

    return value.trim();
  }
}
