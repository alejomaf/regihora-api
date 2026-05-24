import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';

import { EnvironmentVariables } from '../config/environment.validation';
import { BillingStatus, EmployeeStatus, TenantPlan, UserRole } from '../domain/enums';
import { EmployeeEntity } from '../database/entities/employee.entity';
import { SessionEntity } from '../database/entities/session.entity';
import { TenantEntity } from '../database/entities/tenant.entity';
import { UserEntity } from '../database/entities/user.entity';
import { AuthService } from './auth.service';
import { PasswordHasher } from './password/password-hasher.service';

type UserQueryBuilderStub = {
  leftJoinAndSelect: () => UserQueryBuilderStub;
  where: () => UserQueryBuilderStub;
  andWhere: () => UserQueryBuilderStub;
  getOne: () => Promise<UserEntity | null>;
};

const chromeMacUserAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const safariIphoneUserAgent =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

describe(AuthService.name, () => {
  it('registers a self-service owner, tenant, and active owner membership', async () => {
    const { employees, service, tenants, users } = makeRegistrationService();

    const response = await service.registerOwner(
      {
        acceptTerms: true,
        companyLegalName: 'Nueva Empresa S.L.',
        companyTaxId: ' b12345678 ',
        ownerDisplayName: 'Ana Owner',
        ownerEmail: ' ANA@EXAMPLE.COM ',
        password: 'correct-password',
      },
      { ipAddress: '127.0.0.1', userAgent: chromeMacUserAgent },
    );

    expect(tenants).toHaveLength(1);
    expect(tenants[0]).toEqual(
      expect.objectContaining({
        billingStatus: BillingStatus.FREE,
        legalName: 'Nueva Empresa S.L.',
        plan: TenantPlan.FREE,
        taxId: 'B12345678',
        timezone: 'Europe/Madrid',
      }),
    );
    expect(users).toHaveLength(1);
    expect(users[0]).toEqual(
      expect.objectContaining({
        displayName: 'Ana Owner',
        email: 'ana@example.com',
        passwordHash: 'hashed:correct-password',
      }),
    );
    expect(employees).toHaveLength(1);
    expect(employees[0]).toEqual(
      expect.objectContaining({
        email: 'ana@example.com',
        roles: [UserRole.OWNER],
        status: EmployeeStatus.ACTIVE,
        tenantId: tenants[0]?.id,
        userId: users[0]?.id,
      }),
    );
    expect(response.memberships).toEqual([
      {
        employeeId: employees[0]?.id,
        roles: [UserRole.OWNER],
        tenantId: tenants[0]?.id,
        tenantName: 'Nueva Empresa S.L.',
      },
    ]);
  });

  it('rejects owner registration when terms are not accepted', async () => {
    const { service } = makeRegistrationService();

    await expect(
      service.registerOwner(
        {
          acceptTerms: false,
          companyLegalName: 'Nueva Empresa S.L.',
          companyTaxId: 'B12345678',
          ownerDisplayName: 'Ana Owner',
          ownerEmail: 'ana@example.com',
          password: 'correct-password',
        },
        { ipAddress: '127.0.0.1', userAgent: chromeMacUserAgent },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects owner registration for duplicate owner emails', async () => {
    const { service, users } = makeRegistrationService();

    users.push(
      Object.assign(new UserEntity(), {
        email: 'ana@example.com',
        id: 'existing-user',
      }),
    );

    await expect(
      service.registerOwner(
        {
          acceptTerms: true,
          companyLegalName: 'Nueva Empresa S.L.',
          companyTaxId: 'B12345678',
          ownerDisplayName: 'Ana Owner',
          ownerEmail: 'ana@example.com',
          password: 'correct-password',
        },
        { ipAddress: '127.0.0.1', userAgent: chromeMacUserAgent },
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('logs in active users, creates a refresh session, and signs tenant roles', async () => {
    const user = makeUser([
      makeEmployee('tenant-1', 'employee-1', EmployeeStatus.ACTIVE, [
        UserRole.HR_ADMIN,
        UserRole.EMPLOYEE,
      ]),
      makeEmployee('tenant-2', 'employee-2', EmployeeStatus.INACTIVE, [
        UserRole.AUDITOR,
      ]),
    ]);
    const sessions: SessionEntity[] = [];
    const savedSessions: SessionEntity[] = [];
    const signAsync = jest.fn().mockResolvedValue('access-token');
    const jwtService = makeJwtService(signAsync);
    const service = makeService({
      jwtService,
      savedSessions,
      sessions,
      user,
    });

    const response = await service.login(
      { email: ' OWNER@example.com ', password: 'correct-password' },
      { ipAddress: '127.0.0.1', userAgent: chromeMacUserAgent },
    );

    expect(response.accessToken).toBe('access-token');
    expect(response.currentSession.current).toBe(true);
    expect(response.currentSession.deviceLabel).toBe('Chrome en macOS');
    expect(response.currentSession.ipAddress).toBe('127.0.0.1');
    expect(response.securityNotice).toEqual({
      activeSessionCount: 1,
      message: null,
      newDeviceLogin: false,
    });
    expect(response.memberships).toEqual([
      {
        employeeId: 'employee-1',
        roles: [UserRole.HR_ADMIN, UserRole.EMPLOYEE],
        tenantId: 'tenant-1',
        tenantName: 'Empresa actual',
      },
    ]);
    expect(savedSessions).toHaveLength(1);
    expect(savedSessions[0]?.refreshTokenHash.startsWith('hashed:')).toBe(true);
    expect(signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'owner@example.com',
        roles: [UserRole.HR_ADMIN, UserRole.EMPLOYEE],
        sessionId: response.currentSession.id,
        sub: 'user-1',
      }),
      expect.objectContaining({
        audience: 'regihora',
        issuer: 'regihora-api',
        secret: 'test-access-secret',
      }),
    );
  });

  it('marks login responses when another active device already exists', async () => {
    const user = makeUser([
      makeEmployee('tenant-1', 'employee-1', EmployeeStatus.ACTIVE, [
        UserRole.EMPLOYEE,
      ]),
    ]);
    const sessions = [
      makeSession({
        id: 'existing-session',
        refreshTokenHash: 'hashed:existing-secret',
        user,
        userAgent: safariIphoneUserAgent,
      }),
    ];
    const service = makeService({
      savedSessions: [],
      sessions,
      user,
    });

    const response = await service.login(
      { email: 'owner@example.com', password: 'correct-password' },
      { ipAddress: '127.0.0.1', userAgent: chromeMacUserAgent },
    );

    expect(response.securityNotice).toEqual({
      activeSessionCount: 2,
      message: 'A new login was detected from a different device.',
      newDeviceLogin: true,
    });
  });

  it('logs in with Google SSO when Google verifies an active user email', async () => {
    const user = makeUser([
      makeEmployee('tenant-1', 'employee-1', EmployeeStatus.ACTIVE, [
        UserRole.EMPLOYEE,
      ]),
    ]);
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeGoogleTokenInfoResponse({
        aud: 'google-client-id.apps.googleusercontent.com',
        email: 'OWNER@example.com',
      }),
    );
    const service = makeService({
      googleClientId: 'google-client-id.apps.googleusercontent.com',
      savedSessions: [],
      sessions: [],
      user,
    });

    const response = await service.loginWithGoogleSso(
      { credential: 'google-id-token' },
      { ipAddress: '127.0.0.1', userAgent: chromeMacUserAgent },
    );
    const requestedUrl = fetchSpy.mock.calls[0]?.[0];

    expect(response.user.email).toBe('owner@example.com');
    expect(response.memberships).toEqual([
      {
        employeeId: 'employee-1',
        roles: [UserRole.EMPLOYEE],
        tenantId: 'tenant-1',
        tenantName: 'Empresa actual',
      },
    ]);
    expect(requestedUrl).toBeInstanceOf(URL);
    expect((requestedUrl as URL).searchParams.get('id_token')).toBe('google-id-token');

    fetchSpy.mockRestore();
  });

  it('rejects Google SSO when the token audience does not match the configured client', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeGoogleTokenInfoResponse({
        aud: 'another-client-id.apps.googleusercontent.com',
        email: 'owner@example.com',
      }),
    );
    const service = makeService({
      googleClientId: 'google-client-id.apps.googleusercontent.com',
      savedSessions: [],
      sessions: [],
      user: makeUser([]),
    });

    await expect(
      service.loginWithGoogleSso(
        { credential: 'google-id-token' },
        { ipAddress: '127.0.0.1', userAgent: chromeMacUserAgent },
      ),
    ).rejects.toThrow(UnauthorizedException);

    fetchSpy.mockRestore();
  });

  it('rejects Google SSO when Google is not configured', async () => {
    const service = makeService({
      savedSessions: [],
      sessions: [],
      user: makeUser([]),
    });

    await expect(
      service.loginWithGoogleSso(
        { credential: 'google-id-token' },
        { ipAddress: '127.0.0.1', userAgent: chromeMacUserAgent },
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('enforces the strictest tenant device limit by revoking oldest sessions on login', async () => {
    const user = makeUser([
      makeEmployee('tenant-1', 'employee-1', EmployeeStatus.ACTIVE, [
        UserRole.EMPLOYEE,
      ]),
    ]);
    const oldestSession = makeSession({
      createdAt: new Date('2026-01-01T08:00:00.000Z'),
      id: 'oldest-session',
      refreshTokenHash: 'hashed:oldest-secret',
      user,
      userAgent: safariIphoneUserAgent,
    });
    const newestSession = makeSession({
      createdAt: new Date('2026-01-02T08:00:00.000Z'),
      id: 'newest-session',
      refreshTokenHash: 'hashed:newest-secret',
      user,
      userAgent: chromeMacUserAgent,
    });
    const service = makeService({
      savedSessions: [],
      sessions: [oldestSession, newestSession],
      tenants: [makeTenant({ id: 'tenant-1', sessionDeviceLimit: 2 })],
      user,
    });

    const response = await service.login(
      { email: 'owner@example.com', password: 'correct-password' },
      { ipAddress: '127.0.0.1', userAgent: chromeMacUserAgent },
    );

    expect(response.securityNotice.activeSessionCount).toBe(2);
    expect(response.securityNotice.newDeviceLogin).toBe(false);
    expect(oldestSession.revokedAt).toBeInstanceOf(Date);
    expect(newestSession.revokedAt).toBeNull();
  });

  it('rotates refresh tokens by revoking the used session', async () => {
    const user = makeUser([
      makeEmployee('tenant-1', 'employee-1', EmployeeStatus.ACTIVE, [
        UserRole.EMPLOYEE,
      ]),
    ]);
    const oldSession = makeSession({
      id: 'old-session',
      refreshTokenHash: 'hashed:old-secret',
      user,
      userAgent: chromeMacUserAgent,
    });
    const sessions = [oldSession];
    const savedSessions: SessionEntity[] = [];
    const service = makeService({
      savedSessions,
      sessions,
      user,
    });

    const response = await service.refresh(
      { refreshToken: 'old-session.old-secret' },
      { ipAddress: '127.0.0.1', userAgent: chromeMacUserAgent },
    );

    expect(oldSession.revokedAt).toBeInstanceOf(Date);
    expect(oldSession.lastUsedAt).toBe(oldSession.revokedAt);
    expect(response.refreshToken).not.toBe('old-session.old-secret');
    expect(response.currentSession.id).not.toBe('old-session');
    expect(response.securityNotice.newDeviceLogin).toBe(false);
    expect(savedSessions).toHaveLength(2);
  });

  it('rejects a refresh token reused from a different device fingerprint', async () => {
    const user = makeUser([
      makeEmployee('tenant-1', 'employee-1', EmployeeStatus.ACTIVE, [
        UserRole.EMPLOYEE,
      ]),
    ]);
    const oldSession = makeSession({
      id: 'old-session',
      refreshTokenHash: 'hashed:old-secret',
      user,
      userAgent: safariIphoneUserAgent,
    });
    const savedSessions: SessionEntity[] = [];
    const service = makeService({
      savedSessions,
      sessions: [oldSession],
      user,
    });

    await expect(
      service.refresh(
        { refreshToken: 'old-session.old-secret' },
        { ipAddress: '127.0.0.1', userAgent: chromeMacUserAgent },
      ),
    ).rejects.toThrow(UnauthorizedException);

    expect(oldSession.revokedAt).toBeInstanceOf(Date);
    expect(oldSession.lastUsedAt).toBe(oldSession.revokedAt);
    expect(savedSessions).toHaveLength(1);
  });

  it('lists active sessions and marks the current JWT session', async () => {
    const user = makeUser([]);
    const currentSession = makeSession({
      id: 'current-session',
      refreshTokenHash: 'hashed:current-secret',
      user,
      userAgent: chromeMacUserAgent,
    });
    const otherSession = makeSession({
      id: 'other-session',
      refreshTokenHash: 'hashed:other-secret',
      user,
      userAgent: safariIphoneUserAgent,
    });
    const service = makeService({
      savedSessions: [],
      sessions: [currentSession, otherSession],
      user,
    });

    const response = await service.listSessions({
      email: user.email,
      memberships: [],
      roles: [],
      sessionId: 'current-session',
      sub: user.id,
    });

    expect(response.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          current: true,
          deviceLabel: 'Chrome en macOS',
          id: 'current-session',
        }),
        expect.objectContaining({
          current: false,
          deviceLabel: 'Safari en iOS',
          id: 'other-session',
        }),
      ]),
    );
  });

  it('revokes all active sessions except the current JWT session', async () => {
    const user = makeUser([]);
    const currentSession = makeSession({
      id: 'current-session',
      refreshTokenHash: 'hashed:current-secret',
      user,
      userAgent: chromeMacUserAgent,
    });
    const otherSession = makeSession({
      id: 'other-session',
      refreshTokenHash: 'hashed:other-secret',
      user,
      userAgent: safariIphoneUserAgent,
    });
    const service = makeService({
      savedSessions: [],
      sessions: [currentSession, otherSession],
      user,
    });

    const response = await service.revokeOtherSessions({
      email: user.email,
      memberships: [],
      roles: [],
      sessionId: 'current-session',
      sub: user.id,
    });

    expect(currentSession.revokedAt).toBeNull();
    expect(otherSession.revokedAt).toBeInstanceOf(Date);
    expect(response.data).toEqual([
      expect.objectContaining({
        current: true,
        id: 'current-session',
      }),
    ]);
  });

  it('revokes one other active session and rejects revoking the current one directly', async () => {
    const user = makeUser([]);
    const currentSession = makeSession({
      id: 'current-session',
      refreshTokenHash: 'hashed:current-secret',
      user,
      userAgent: chromeMacUserAgent,
    });
    const otherSession = makeSession({
      id: 'other-session',
      refreshTokenHash: 'hashed:other-secret',
      user,
      userAgent: safariIphoneUserAgent,
    });
    const service = makeService({
      savedSessions: [],
      sessions: [currentSession, otherSession],
      user,
    });
    const auth = {
      email: user.email,
      memberships: [],
      roles: [],
      sessionId: 'current-session',
      sub: user.id,
    };

    await service.revokeSession(auth, 'other-session');

    expect(otherSession.revokedAt).toBeInstanceOf(Date);
    await expect(service.revokeSession(auth, 'current-session')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('revokes the matching refresh session on logout', async () => {
    const oldSession = makeSession({
      id: 'old-session',
      refreshTokenHash: 'hashed:old-secret',
      user: makeUser([]),
    });
    const service = makeService({
      savedSessions: [],
      sessions: [oldSession],
      user: null,
    });

    await service.logout({ refreshToken: 'old-session.old-secret' });

    expect(oldSession.revokedAt).toBeInstanceOf(Date);
    expect(oldSession.lastUsedAt).toBe(oldSession.revokedAt);
  });
});

function makeService(options: {
  user: UserEntity | null;
  savedSessions: SessionEntity[];
  sessions: SessionEntity[];
  googleClientId?: string | null;
  tenants?: TenantEntity[];
  jwtService?: JwtService;
}): AuthService {
  const userQueryBuilder: UserQueryBuilderStub = {
    andWhere: () => userQueryBuilder,
    getOne: () => Promise.resolve(options.user),
    leftJoinAndSelect: () => userQueryBuilder,
    where: () => userQueryBuilder,
  };
  const userRepository = {
    createQueryBuilder: () => userQueryBuilder,
  } as unknown as Repository<UserEntity>;
  const sessionRepository = {
    create: (session: Partial<SessionEntity>) =>
      Object.assign(new SessionEntity(), session),
    find: (query: { where?: Record<string, unknown> }) =>
      Promise.resolve(
        options.sessions
          .filter((session) => matchesSessionWhere(session, query.where))
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()),
      ),
    findOne: (query: { where?: Record<string, unknown> }) =>
      Promise.resolve(
        options.sessions.find((session) => matchesSessionWhere(session, query.where)) ??
          null,
      ),
    save: (sessionOrSessions: SessionEntity | SessionEntity[]) => {
      const saved = Array.isArray(sessionOrSessions)
        ? sessionOrSessions.map((session) => saveSession(options.sessions, session))
        : saveSession(options.sessions, sessionOrSessions);

      if (Array.isArray(saved)) {
        options.savedSessions.push(...saved);
      } else {
        options.savedSessions.push(saved);
      }

      return Promise.resolve(saved);
    },
  } as unknown as Repository<SessionEntity>;
  const tenantRepository = {
    find: () => Promise.resolve(options.tenants ?? makeTenantsForUser(options.user)),
  } as unknown as Repository<TenantEntity>;

  return new AuthService(
    userRepository,
    sessionRepository,
    tenantRepository,
    makeConfigService(options.googleClientId ?? null),
    options.jwtService ?? makeJwtService(),
    makePasswordHasher(),
  );
}

function makeRegistrationService(): {
  employees: EmployeeEntity[];
  service: AuthService;
  tenants: TenantEntity[];
  users: UserEntity[];
} {
  const employees: EmployeeEntity[] = [];
  const savedSessions: SessionEntity[] = [];
  const sessions: SessionEntity[] = [];
  const tenants: TenantEntity[] = [];
  const users: UserEntity[] = [];

  const tenantRepository = {
    create: (tenant: Partial<TenantEntity>) =>
      Object.assign(new TenantEntity(), tenant),
    find: () => Promise.resolve(tenants),
    findOneBy: (where: Partial<TenantEntity>) =>
      Promise.resolve(
        tenants.find(
          (tenant) =>
            (where.id === undefined || tenant.id === where.id) &&
            (where.taxId === undefined || tenant.taxId === where.taxId),
        ) ?? null,
      ),
    save: (tenant: Partial<TenantEntity>) => {
      const savedTenant = Object.assign(new TenantEntity(), tenant, {
        billingCurrentPeriodEnd: null,
        billingStatus: tenant.billingStatus ?? BillingStatus.FREE,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        id: `tenant-${String(tenants.length + 1)}`,
        locale: tenant.locale ?? 'es-ES',
        plan: tenant.plan ?? TenantPlan.FREE,
        sessionDeviceLimit: null,
        stripeCustomerId: null,
        stripePriceId: null,
        stripeSubscriptionId: null,
        timezone: tenant.timezone ?? 'Europe/Madrid',
        trialEndsAt: null,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      tenants.push(savedTenant);

      return Promise.resolve(savedTenant);
    },
  } as unknown as Repository<TenantEntity>;
  const employeeRepository = {
    create: (employee: Partial<EmployeeEntity>) =>
      Object.assign(new EmployeeEntity(), employee),
    save: (employee: EmployeeEntity) => {
      const savedEmployee = Object.assign(new EmployeeEntity(), employee, {
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        departmentId: null,
        id: `employee-${String(employees.length + 1)}`,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        workplaceId: null,
      });

      employees.push(savedEmployee);

      return Promise.resolve(savedEmployee);
    },
  } as unknown as Repository<EmployeeEntity>;
  const userRepository = {
    create: (user: Partial<UserEntity>) => Object.assign(new UserEntity(), user),
    findOneBy: (where: Partial<UserEntity>) =>
      Promise.resolve(
        users.find((user) => where.email !== undefined && user.email === where.email) ??
          null,
      ),
    manager: {
      transaction: <T>(
        callback: (manager: { getRepository: (entity: unknown) => unknown }) => Promise<T>,
      ) =>
        callback({
          getRepository: (entity: unknown) => {
            if (entity === UserEntity) {
              return userRepository;
            }

            if (entity === TenantEntity) {
              return tenantRepository;
            }

            if (entity === EmployeeEntity) {
              return employeeRepository;
            }

            throw new Error('Unexpected repository.');
          },
        }),
    },
    save: (user: UserEntity) => {
      const savedUser = Object.assign(new UserEntity(), user, {
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        employees: [],
        id: `user-${String(users.length + 1)}`,
        isActive: true,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      users.push(savedUser);

      return Promise.resolve(savedUser);
    },
  } as unknown as Repository<UserEntity>;
  const sessionRepository = {
    create: (session: Partial<SessionEntity>) =>
      Object.assign(new SessionEntity(), session),
    find: () => Promise.resolve(sessions),
    findOne: () => Promise.resolve(null),
    save: (session: SessionEntity) => {
      const saved = saveSession(sessions, session);

      savedSessions.push(saved);

      return Promise.resolve(saved);
    },
  } as unknown as Repository<SessionEntity>;

  return {
    employees,
    service: new AuthService(
      userRepository,
      sessionRepository,
      tenantRepository,
      makeConfigService(null),
      makeJwtService(),
      makePasswordHasher(),
    ),
    tenants,
    users,
  };
}

function matchesSessionWhere(
  session: SessionEntity,
  where: Record<string, unknown> | undefined,
): boolean {
  if (where === undefined) {
    return true;
  }

  const id = where.id;
  const userId = where.userId;

  if (typeof id === 'string' && session.id !== id) {
    return false;
  }

  if (typeof userId === 'string' && session.userId !== userId) {
    return false;
  }

  if ('revokedAt' in where && session.revokedAt !== null) {
    return false;
  }

  if ('expiresAt' in where && session.expiresAt <= new Date()) {
    return false;
  }

  return true;
}

function saveSession(sessions: SessionEntity[], session: SessionEntity): SessionEntity {
  if (!(session.createdAt instanceof Date)) {
    session.createdAt = new Date('2026-01-02T00:00:00.000Z');
  }

  const existingIndex = sessions.findIndex((candidate) => candidate.id === session.id);

  if (existingIndex === -1) {
    sessions.push(session);
  } else {
    sessions[existingIndex] = session;
  }

  return session;
}

function makeConfigService(
  googleClientId: string | null,
): ConfigService<EnvironmentVariables, true> {
  const values = {
    GOOGLE_OAUTH_CLIENT_ID: googleClientId,
    JWT_ACCESS_TOKEN_SECRET: 'test-access-secret',
    JWT_ACCESS_TOKEN_TTL_SECONDS: 900,
    JWT_AUDIENCE: 'regihora',
    JWT_ISSUER: 'regihora-api',
    JWT_REFRESH_TOKEN_TTL_SECONDS: 2_592_000,
  };

  return {
    get: (key: keyof typeof values) => values[key],
  } as ConfigService<EnvironmentVariables, true>;
}

function makeGoogleTokenInfoResponse(overrides: {
  aud: string;
  email: string;
  emailVerified?: boolean | string;
  exp?: number;
  iss?: string;
}): Response {
  return new Response(
    JSON.stringify({
      aud: overrides.aud,
      email: overrides.email,
      email_verified: overrides.emailVerified ?? 'true',
      exp: overrides.exp ?? Math.floor(Date.now() / 1_000) + 300,
      iss: overrides.iss ?? 'https://accounts.google.com',
    }),
    {
      headers: {
        'Content-Type': 'application/json',
      },
      status: 200,
    },
  );
}

function makeJwtService(signAsync = jest.fn().mockResolvedValue('access-token')): JwtService {
  return {
    signAsync,
  } as unknown as JwtService;
}

function makePasswordHasher(): PasswordHasher {
  return {
    hash: (value: string) => Promise.resolve(`hashed:${value}`),
    verify: (hash: string, value: string) => Promise.resolve(hash === `hashed:${value}`),
  };
}

function makeUser(employees: EmployeeEntity[]): UserEntity {
  return Object.assign(new UserEntity(), {
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    displayName: 'Owner User',
    email: 'owner@example.com',
    employees,
    id: 'user-1',
    isActive: true,
    passwordHash: 'hashed:correct-password',
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
}

function makeTenantsForUser(user: UserEntity | null): TenantEntity[] {
  if (user === null) {
    return [];
  }

  return [
    ...new Set(user.employees.map((employee) => employee.tenantId)),
  ].map((tenantId) => makeTenant({ id: tenantId }));
}

function makeTenant(overrides: Partial<TenantEntity> = {}): TenantEntity {
  return Object.assign(new TenantEntity(), {
    id: 'tenant-1',
    billingCurrentPeriodEnd: null,
    billingStatus: BillingStatus.FREE,
    legalName: 'Empresa actual',
    locale: 'es-ES',
    plan: TenantPlan.FREE,
    sessionDeviceLimit: null,
    stripeCustomerId: null,
    stripePriceId: null,
    stripeSubscriptionId: null,
    taxId: 'B00000000',
    timezone: 'Europe/Madrid',
    trialEndsAt: null,
    ...overrides,
  });
}

function makeEmployee(
  tenantId: string,
  id: string,
  status: EmployeeStatus,
  roles: UserRole[],
): EmployeeEntity {
  return Object.assign(new EmployeeEntity(), {
    id,
    roles,
    status,
    tenantId,
  });
}

function makeSession(options: {
  createdAt?: Date;
  id: string;
  refreshTokenHash: string;
  user: UserEntity;
  userAgent?: string | null;
}): SessionEntity {
  return Object.assign(new SessionEntity(), {
    createdAt: options.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    id: options.id,
    ipAddress: null,
    lastUsedAt: null,
    refreshTokenHash: options.refreshTokenHash,
    revokedAt: null,
    user: options.user,
    userAgent: options.userAgent ?? null,
    userId: options.user.id,
  });
}
