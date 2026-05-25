import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThan, Repository } from 'typeorm';

import { EnvironmentVariables } from '../config/environment.validation';
import { BillingStatus, EmployeeStatus, TenantPlan, UserRole } from '../domain/enums';
import { EmployeeEntity } from '../database/entities/employee.entity';
import { EmployeeInvitationEntity } from '../database/entities/employee-invitation.entity';
import { SessionEntity } from '../database/entities/session.entity';
import { TenantEntity } from '../database/entities/tenant.entity';
import { UserEntity } from '../database/entities/user.entity';
import {
  AuthMembershipDto,
  AuthResponseDto,
  AuthSessionListResponseDto,
  AuthUserSessionDto,
} from './dto/auth-response.dto';
import {
  AcceptEmployeeInvitationRequestDto,
  EmployeeInvitationAuthPreviewDto,
} from './dto/employee-invitation-auth.dto';
import { GoogleSsoLoginRequestDto } from './dto/google-sso-login-request.dto';
import { LoginRequestDto } from './dto/login-request.dto';
import { OwnerRegistrationRequestDto } from './dto/owner-registration-request.dto';
import { RefreshTokenRequestDto } from './dto/refresh-token-request.dto';
import { PasswordHasher } from './password/password-hasher.service';
import { RequestAuthContext } from './types/authenticated-principal';

type RefreshTokenParts = {
  sessionId: string;
  secret: string;
};

type CreatedSession = {
  refreshToken: string;
  session: SessionEntity;
};

type GoogleTokenInfo = {
  aud?: unknown;
  email?: unknown;
  email_verified?: unknown;
  exp?: unknown;
  iss?: unknown;
};

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(SessionEntity)
    private readonly sessionRepository: Repository<SessionEntity>,
    @InjectRepository(TenantEntity)
    private readonly tenantRepository: Repository<TenantEntity>,
    @InjectRepository(EmployeeInvitationEntity)
    private readonly employeeInvitationRepository: Repository<EmployeeInvitationEntity>,
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

    return this.createSessionResponse(user, context, true);
  }

  async loginWithGoogleSso(
    request: GoogleSsoLoginRequestDto,
    context: RequestAuthContext,
  ): Promise<AuthResponseDto> {
    const clientId = this.configService.get('GOOGLE_OAUTH_CLIENT_ID', { infer: true });

    if (clientId === null) {
      throw new UnauthorizedException('Google SSO is not configured.');
    }

    const credential = this.parseNonEmptyString(request.credential, 'credential');
    const tokenInfo = await this.fetchGoogleTokenInfo(credential);
    const email = this.parseVerifiedGoogleEmail(tokenInfo, clientId);
    const user = await this.findActiveUserByEmail(email);

    if (user === null) {
      throw new UnauthorizedException('Google account is not linked to Regihora.');
    }

    return this.createSessionResponse(user, context, true);
  }

  async registerOwner(
    request: OwnerRegistrationRequestDto,
    context: RequestAuthContext,
  ): Promise<AuthResponseDto> {
    const companyLegalName = this.parsePublicString(
      request.companyLegalName,
      'companyLegalName',
      2,
      200,
    );
    const companyTaxId = this.parsePublicString(
      request.companyTaxId,
      'companyTaxId',
      3,
      32,
    ).toUpperCase();
    const ownerDisplayName = this.parsePublicString(
      request.ownerDisplayName,
      'ownerDisplayName',
      2,
      160,
    );
    const ownerEmail = this.parsePublicEmail(request.ownerEmail, 'ownerEmail');
    const password = this.parsePassword(request.password);
    const timezone = this.parseOptionalPublicString(
      request.timezone,
      'timezone',
      1,
      64,
      'Europe/Madrid',
    );
    const locale = this.parseOptionalPublicString(
      request.locale,
      'locale',
      2,
      16,
      'es-ES',
    );

    if (request.acceptTerms !== true) {
      throw new BadRequestException('acceptTerms must be true.');
    }

    validateTimezone(timezone, 'timezone');

    const created = await this.userRepository.manager.transaction(async (manager) => {
      const userRepository = manager.getRepository(UserEntity);
      const tenantRepository = manager.getRepository(TenantEntity);
      const employeeRepository = manager.getRepository(EmployeeEntity);

      const existingUser = await userRepository.findOneBy({ email: ownerEmail });

      if (existingUser !== null) {
        throw new ConflictException('A user with this email already exists.');
      }

      const existingTenant = await tenantRepository.findOneBy({ taxId: companyTaxId });

      if (existingTenant !== null) {
        throw new ConflictException('A company with this tax identifier already exists.');
      }

      const tenant = await tenantRepository.save(
        tenantRepository.create({
          billingStatus: BillingStatus.FREE,
          legalName: companyLegalName,
          locale,
          plan: TenantPlan.FREE,
          taxId: companyTaxId,
          timezone,
        }),
      );
      const user = await userRepository.save(
        userRepository.create({
          displayName: ownerDisplayName,
          email: ownerEmail,
          isActive: true,
          passwordHash: await this.passwordHasher.hash(password),
        }),
      );
      const employee = await employeeRepository.save(
        employeeRepository.create({
          displayName: ownerDisplayName,
          email: ownerEmail,
          roles: [UserRole.OWNER],
          status: EmployeeStatus.ACTIVE,
          tenantId: tenant.id,
          userId: user.id,
        }),
      );

      user.employees = [employee];

      return user;
    });

    return this.createSessionResponse(created, context, false);
  }

  async getEmployeeInvitation(
    token: string,
  ): Promise<EmployeeInvitationAuthPreviewDto> {
    const invitation = await this.getPendingInvitationByToken(token);

    return {
      displayName: invitation.employee.displayName,
      email: invitation.email,
      expiresAt: invitation.expiresAt.toISOString(),
      requiresPassword: true,
      tenantName: invitation.tenant.legalName,
    };
  }

  async acceptEmployeeInvitation(
    request: AcceptEmployeeInvitationRequestDto,
    context: RequestAuthContext,
  ): Promise<AuthResponseDto> {
    const token = this.parsePublicString(request.token, 'token', 32, 512);
    const tokenHash = hashEmployeeInvitationToken(token);
    const acceptedUserId = await this.userRepository.manager.transaction(
      async (manager) => {
        const userRepository = manager.getRepository(UserEntity);
        const employeeRepository = manager.getRepository(EmployeeEntity);
        const invitationRepository = manager.getRepository(EmployeeInvitationEntity);
        const invitation = await invitationRepository.findOne({
          relations: {
            employee: true,
            tenant: true,
          },
          where: {
            tokenHash,
          },
        });

        this.assertInvitationCanBeAccepted(invitation);

        const employee = invitation.employee;
        const email = invitation.email.toLowerCase();

        if (employee.email.toLowerCase() !== email) {
          throw new BadRequestException('Invitation no longer matches employee email.');
        }

        let user = await findUserByEmail(userRepository, email);
        const password = this.parsePassword(request.password);

        if (user === null) {
          user = await userRepository.save(
            userRepository.create({
              displayName: employee.displayName,
              email,
              isActive: true,
              passwordHash: await this.passwordHasher.hash(password),
            }),
          );
        } else {
          if (!user.isActive) {
            throw new ConflictException('User account is inactive.');
          }

          if (user.passwordHash === null) {
            user.passwordHash = await this.passwordHasher.hash(password);
            user = await userRepository.save(user);
          } else if (!(await this.passwordHasher.verify(user.passwordHash, password))) {
            throw new UnauthorizedException('Invalid email or password.');
          }
        }

        if (employee.userId !== null && employee.userId !== user.id) {
          throw new ConflictException('Employee is already linked to another user.');
        }

        employee.status = EmployeeStatus.ACTIVE;
        employee.userId = user.id;
        invitation.acceptedAt = new Date();

        await employeeRepository.save(employee);
        await invitationRepository.save(invitation);

        return user.id;
      },
    );
    const user = await this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.employees', 'employee')
      .where('user.id = :id', { id: acceptedUserId })
      .andWhere('user.is_active = true')
      .getOne();

    if (user === null) {
      throw new UnauthorizedException('User is inactive.');
    }

    return this.createSessionResponse(user, context, false);
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

    if (!isSameKnownDevice(session.userAgent, context.userAgent)) {
      session.revokedAt = new Date();
      session.lastUsedAt = session.revokedAt;
      await this.sessionRepository.save(session);

      throw new UnauthorizedException('Refresh token was used from another device.');
    }

    session.revokedAt = new Date();
    session.lastUsedAt = session.revokedAt;
    await this.sessionRepository.save(session);

    if (!session.user.isActive) {
      throw new UnauthorizedException('User is inactive.');
    }

    return this.createSessionResponse(session.user, context, false);
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

  async listSessions(auth: {
    sub: string;
    sessionId?: string;
  }): Promise<AuthSessionListResponseDto> {
    const sessions = await this.findActiveSessions(auth.sub);

    return {
      data: this.mapUserSessions(sessions, auth.sessionId ?? null),
    };
  }

  async revokeOtherSessions(auth: {
    sub: string;
    sessionId?: string;
  }): Promise<AuthSessionListResponseDto> {
    const currentSessionId = this.getCurrentSessionId(auth);
    const sessions = await this.findActiveSessions(auth.sub);
    const now = new Date();
    const sessionsToRevoke = sessions.filter((session) => session.id !== currentSessionId);

    if (sessionsToRevoke.length > 0) {
      sessionsToRevoke.forEach((session) => {
        session.revokedAt = now;
        session.lastUsedAt = now;
      });
      await this.sessionRepository.save(sessionsToRevoke);
    }

    return {
      data: this.mapUserSessions(
        sessions.filter((session) => session.id === currentSessionId),
        currentSessionId,
      ),
    };
  }

  async revokeSession(auth: { sub: string; sessionId?: string }, sessionId: string): Promise<void> {
    const currentSessionId = auth.sessionId ?? null;

    if (sessionId === currentSessionId) {
      throw new BadRequestException('Use logout to revoke the current session.');
    }

    const session = await this.sessionRepository.findOne({
      where: {
        expiresAt: MoreThan(new Date()),
        id: sessionId,
        revokedAt: IsNull(),
        userId: auth.sub,
      },
    });

    if (session === null) {
      throw new NotFoundException('Session not found.');
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

  private async getPendingInvitationByToken(
    token: string,
  ): Promise<EmployeeInvitationEntity & { employee: EmployeeEntity; tenant: TenantEntity }> {
    const invitation = await this.employeeInvitationRepository.findOne({
      relations: {
        employee: true,
        tenant: true,
      },
      where: {
        tokenHash: hashEmployeeInvitationToken(token),
      },
    });

    this.assertInvitationCanBeAccepted(invitation);

    return invitation;
  }

  private assertInvitationCanBeAccepted(
    invitation: EmployeeInvitationEntity | null,
  ): asserts invitation is EmployeeInvitationEntity & {
    employee: EmployeeEntity;
    tenant: TenantEntity;
  } {
    if (invitation === null) {
      throw new NotFoundException('Invitation not found.');
    }

    if (invitation.revokedAt !== null || invitation.acceptedAt !== null) {
      throw new BadRequestException('Invitation is no longer valid.');
    }

    if (invitation.expiresAt <= new Date()) {
      throw new BadRequestException('Invitation has expired.');
    }

    if (invitation.employee.status === EmployeeStatus.INACTIVE) {
      throw new BadRequestException('Employee is inactive.');
    }
  }

  private async fetchGoogleTokenInfo(credential: string): Promise<GoogleTokenInfo> {
    const url = new URL('https://oauth2.googleapis.com/tokeninfo');

    url.searchParams.set('id_token', credential);

    let response: Response;

    try {
      response = await fetch(url);
    } catch {
      throw new UnauthorizedException('Google SSO verification failed.');
    }

    if (!response.ok) {
      throw new UnauthorizedException('Google SSO verification failed.');
    }

    let body: unknown;

    try {
      body = await response.json();
    } catch {
      throw new UnauthorizedException('Google SSO verification failed.');
    }

    if (!isRecord(body)) {
      throw new UnauthorizedException('Google SSO verification failed.');
    }

    return body;
  }

  private parseVerifiedGoogleEmail(
    tokenInfo: GoogleTokenInfo,
    clientId: string,
  ): string {
    if (tokenInfo.aud !== clientId) {
      throw new UnauthorizedException('Google SSO verification failed.');
    }

    if (
      tokenInfo.iss !== 'accounts.google.com' &&
      tokenInfo.iss !== 'https://accounts.google.com'
    ) {
      throw new UnauthorizedException('Google SSO verification failed.');
    }

    if (!isTrueTokenClaim(tokenInfo.email_verified)) {
      throw new UnauthorizedException('Google email is not verified.');
    }

    if (!isFutureUnixTimestamp(tokenInfo.exp)) {
      throw new UnauthorizedException('Google SSO credential has expired.');
    }

    if (typeof tokenInfo.email !== 'string') {
      throw new UnauthorizedException('Google SSO verification failed.');
    }

    return this.parseEmail(tokenInfo.email);
  }

  private async createSessionResponse(
    user: UserEntity,
    context: RequestAuthContext,
    includeNewDeviceNotice: boolean,
  ): Promise<AuthResponseDto> {
    const memberships = await this.getActiveMemberships(user.employees);
    const createdSession = await this.createRefreshSession(user.id, context);
    const sessionDeviceLimit = await this.getSessionDeviceLimit(user.employees);
    const remainingSessions = await this.enforceSessionDeviceLimit(
      user.id,
      createdSession.session.id,
      sessionDeviceLimit,
    );
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
        sessionId: createdSession.session.id,
        sub: user.id,
      },
      {
        audience: this.configService.get('JWT_AUDIENCE', { infer: true }),
        expiresIn: accessTokenTtlSeconds,
        issuer: this.configService.get('JWT_ISSUER', { infer: true }),
        secret: this.configService.get('JWT_ACCESS_TOKEN_SECRET', { infer: true }),
      },
    );
    const newDeviceLogin =
      includeNewDeviceNotice &&
      remainingSessions.some(
        (session) =>
          session.id !== createdSession.session.id &&
          hasDifferentKnownDevice(session.userAgent, context.userAgent),
      );

    return {
      accessToken,
      currentSession: this.mapUserSession(createdSession.session, createdSession.session.id),
      expiresAt: expiresAt.toISOString(),
      memberships,
      refreshToken: createdSession.refreshToken,
      securityNotice: {
        activeSessionCount: remainingSessions.length,
        message: newDeviceLogin
          ? 'A new login was detected from a different device.'
          : null,
        newDeviceLogin,
      },
      tokenType: 'Bearer',
      user: {
        createdAt: user.createdAt.toISOString(),
        displayName: user.displayName,
        email: user.email,
        id: user.id,
      },
    };
  }

  private async createRefreshSession(
    userId: string,
    context: RequestAuthContext,
  ): Promise<CreatedSession> {
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
      lastUsedAt: new Date(),
      refreshTokenHash: await this.passwordHasher.hash(secret),
      revokedAt: null,
      userAgent: context.userAgent,
      userId,
    });

    const savedSession = await this.sessionRepository.save(session);

    return {
      refreshToken: `${sessionId}.${secret}`,
      session: savedSession,
    };
  }

  private async findActiveSessions(userId: string): Promise<SessionEntity[]> {
    return this.sessionRepository.find({
      order: {
        createdAt: 'DESC',
      },
      where: {
        expiresAt: MoreThan(new Date()),
        revokedAt: IsNull(),
        userId,
      },
    });
  }

  private async getSessionDeviceLimit(employees: EmployeeEntity[]): Promise<number | null> {
    const tenantIds = [
      ...new Set(
        employees
          .filter((employee) => employee.status === EmployeeStatus.ACTIVE)
          .map((employee) => employee.tenantId),
      ),
    ];

    if (tenantIds.length === 0) {
      return null;
    }

    const tenants = await this.tenantRepository.find({
      where: {
        id: In(tenantIds),
      },
    });
    const configuredLimits = tenants
      .map((tenant) => tenant.sessionDeviceLimit)
      .filter((limit): limit is number => limit !== null);

    if (configuredLimits.length === 0) {
      return null;
    }

    return Math.min(...configuredLimits);
  }

  private async enforceSessionDeviceLimit(
    userId: string,
    currentSessionId: string,
    sessionDeviceLimit: number | null,
  ): Promise<SessionEntity[]> {
    const sessions = await this.findActiveSessions(userId);

    if (sessionDeviceLimit === null || sessions.length <= sessionDeviceLimit) {
      return sessions;
    }

    const currentSession = sessions.find((session) => session.id === currentSessionId);
    const otherSessions = sessions.filter((session) => session.id !== currentSessionId);
    const sessionsToKeep = [
      ...(currentSession === undefined ? [] : [currentSession]),
      ...otherSessions.slice(0, Math.max(sessionDeviceLimit - 1, 0)),
    ];
    const sessionIdsToKeep = new Set(sessionsToKeep.map((session) => session.id));
    const now = new Date();
    const sessionsToRevoke = sessions.filter(
      (session) => !sessionIdsToKeep.has(session.id),
    );

    sessionsToRevoke.forEach((session) => {
      session.revokedAt = now;
      session.lastUsedAt = now;
    });
    await this.sessionRepository.save(sessionsToRevoke);

    return sessionsToKeep;
  }

  private getCurrentSessionId(auth: { sessionId?: string }): string {
    if (auth.sessionId === undefined) {
      throw new BadRequestException('Current session is not identifiable.');
    }

    return auth.sessionId;
  }

  private mapUserSessions(
    sessions: SessionEntity[],
    currentSessionId: string | null,
  ): AuthUserSessionDto[] {
    return sessions.map((session) => this.mapUserSession(session, currentSessionId));
  }

  private mapUserSession(
    session: SessionEntity,
    currentSessionId: string | null,
  ): AuthUserSessionDto {
    return {
      createdAt: toIsoString(session.createdAt),
      current: currentSessionId !== null && session.id === currentSessionId,
      deviceLabel: getDeviceLabel(session.userAgent),
      expiresAt: toIsoString(session.expiresAt),
      id: session.id,
      ipAddress: session.ipAddress,
      lastUsedAt: session.lastUsedAt?.toISOString() ?? null,
      userAgent: session.userAgent,
    };
  }

  private async getActiveMemberships(employees: EmployeeEntity[]): Promise<AuthMembershipDto[]> {
    const activeEmployees = employees.filter(
      (employee) => employee.status === EmployeeStatus.ACTIVE,
    );
    const tenantIds = [...new Set(activeEmployees.map((employee) => employee.tenantId))];
    const tenants =
      tenantIds.length === 0
        ? []
        : await this.tenantRepository.find({
            where: {
              id: In(tenantIds),
            },
          });
    const tenantNames = new Map(tenants.map((tenant) => [tenant.id, tenant.legalName]));

    return activeEmployees.map((employee) => ({
      employeeId: employee.id,
      roles: employee.roles,
      tenantId: employee.tenantId,
      tenantName: tenantNames.get(employee.tenantId) ?? 'Empresa actual',
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

  private parsePublicEmail(value: unknown, name: string): string {
    const email = this.parsePublicString(value, name, 3, 320).toLowerCase();

    if (!email.includes('@')) {
      throw new BadRequestException(`${name} must be a valid email.`);
    }

    return email;
  }

  private parsePassword(value: unknown): string {
    const password = this.parsePublicString(value, 'password', 8, 256);

    if (password.trim() !== password) {
      throw new BadRequestException('password must not start or end with whitespace.');
    }

    return password;
  }

  private parsePublicString(
    value: unknown,
    name: string,
    minLength: number,
    maxLength: number,
  ): string {
    if (typeof value !== 'string') {
      throw new BadRequestException(`${name} is required.`);
    }

    const trimmed = value.trim();

    if (trimmed.length < minLength || trimmed.length > maxLength) {
      throw new BadRequestException(
        `${name} must be between ${String(minLength)} and ${String(maxLength)} characters.`,
      );
    }

    return trimmed;
  }

  private parseOptionalPublicString(
    value: unknown,
    name: string,
    minLength: number,
    maxLength: number,
    fallback: string,
  ): string {
    if (value === undefined || value === null || value === '') {
      return fallback;
    }

    return this.parsePublicString(value, name, minLength, maxLength);
  }

  private parseNonEmptyString(value: unknown, name: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new UnauthorizedException(`${name} is required.`);
    }

    return value.trim();
  }
}

function validateTimezone(timezone: string, name: string): void {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
  } catch {
    throw new BadRequestException(`${name} must be a valid IANA timezone.`);
  }
}

function findUserByEmail(
  userRepository: Repository<UserEntity>,
  email: string,
): Promise<UserEntity | null> {
  return userRepository
    .createQueryBuilder('user')
    .where('LOWER(user.email) = :email', { email })
    .getOne();
}

function hashEmployeeInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toIsoString(value: Date): string {
  return value.toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTrueTokenClaim(value: unknown): boolean {
  return value === true || value === 'true';
}

function isFutureUnixTimestamp(value: unknown): boolean {
  const parsedValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;

  return Number.isFinite(parsedValue) && parsedValue > Date.now() / 1_000;
}

function isSameKnownDevice(
  previousUserAgent: string | null,
  currentUserAgent: string | null,
): boolean {
  if (previousUserAgent === null || currentUserAgent === null) {
    return true;
  }

  return getDeviceFingerprint(previousUserAgent) === getDeviceFingerprint(currentUserAgent);
}

function hasDifferentKnownDevice(
  previousUserAgent: string | null,
  currentUserAgent: string | null,
): boolean {
  if (previousUserAgent === null || currentUserAgent === null) {
    return false;
  }

  return getDeviceFingerprint(previousUserAgent) !== getDeviceFingerprint(currentUserAgent);
}

function getDeviceFingerprint(userAgent: string): string {
  return `${getBrowserFamily(userAgent)}:${getPlatformFamily(userAgent)}`;
}

function getDeviceLabel(userAgent: string | null): string {
  if (userAgent === null) {
    return 'Dispositivo desconocido';
  }

  const browser = getBrowserLabel(userAgent);
  const platform = getPlatformLabel(userAgent);

  if (browser === 'Navegador desconocido' && platform === 'sistema desconocido') {
    return 'Dispositivo desconocido';
  }

  return `${browser} en ${platform}`;
}

function getBrowserFamily(userAgent: string): string {
  const normalized = userAgent.toLowerCase();

  if (normalized.includes('edg/')) {
    return 'edge';
  }

  if (normalized.includes('firefox/')) {
    return 'firefox';
  }

  if (normalized.includes('chrome/') || normalized.includes('crios/')) {
    return 'chrome';
  }

  if (normalized.includes('safari/')) {
    return 'safari';
  }

  return 'unknown-browser';
}

function getBrowserLabel(userAgent: string): string {
  switch (getBrowserFamily(userAgent)) {
    case 'edge':
      return 'Microsoft Edge';
    case 'firefox':
      return 'Firefox';
    case 'chrome':
      return 'Chrome';
    case 'safari':
      return 'Safari';
    default:
      return 'Navegador desconocido';
  }
}

function getPlatformFamily(userAgent: string): string {
  const normalized = userAgent.toLowerCase();

  if (normalized.includes('iphone') || normalized.includes('ipad')) {
    return 'ios';
  }

  if (normalized.includes('android')) {
    return 'android';
  }

  if (normalized.includes('mac os x') || normalized.includes('macintosh')) {
    return 'macos';
  }

  if (normalized.includes('windows')) {
    return 'windows';
  }

  if (normalized.includes('linux')) {
    return 'linux';
  }

  return 'unknown-platform';
}

function getPlatformLabel(userAgent: string): string {
  switch (getPlatformFamily(userAgent)) {
    case 'ios':
      return 'iOS';
    case 'android':
      return 'Android';
    case 'macos':
      return 'macOS';
    case 'windows':
      return 'Windows';
    case 'linux':
      return 'Linux';
    default:
      return 'sistema desconocido';
  }
}
