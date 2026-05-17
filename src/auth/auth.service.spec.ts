import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';

import { EnvironmentVariables } from '../config/environment.validation';
import { EmployeeStatus, UserRole } from '../domain/enums';
import { EmployeeEntity } from '../database/entities/employee.entity';
import { SessionEntity } from '../database/entities/session.entity';
import { UserEntity } from '../database/entities/user.entity';
import { AuthService } from './auth.service';
import { PasswordHasher } from './password/password-hasher.service';

type UserQueryBuilderStub = {
  leftJoinAndSelect: () => UserQueryBuilderStub;
  where: () => UserQueryBuilderStub;
  andWhere: () => UserQueryBuilderStub;
  getOne: () => Promise<UserEntity | null>;
};

describe(AuthService.name, () => {
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
    const savedSessions: SessionEntity[] = [];
    const signAsync = jest.fn().mockResolvedValue('access-token');
    const jwtService = makeJwtService(signAsync);
    const service = makeService({
      jwtService,
      savedSessions,
      user,
    });

    const response = await service.login(
      { email: ' OWNER@example.com ', password: 'correct-password' },
      { ipAddress: '127.0.0.1', userAgent: 'jest' },
    );

    expect(response.accessToken).toBe('access-token');
    expect(response.memberships).toEqual([
      {
        employeeId: 'employee-1',
        roles: [UserRole.HR_ADMIN, UserRole.EMPLOYEE],
        tenantId: 'tenant-1',
      },
    ]);
    expect(savedSessions).toHaveLength(1);
    expect(savedSessions[0]?.refreshTokenHash.startsWith('hashed:')).toBe(true);
    expect(signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'owner@example.com',
        roles: [UserRole.HR_ADMIN, UserRole.EMPLOYEE],
        sub: 'user-1',
      }),
      expect.objectContaining({
        audience: 'salidia',
        issuer: 'salidia-api',
        secret: 'test-access-secret',
      }),
    );
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
    });
    const savedSessions: SessionEntity[] = [];
    const service = makeService({
      findSession: oldSession,
      savedSessions,
      user,
    });

    const response = await service.refresh(
      { refreshToken: 'old-session.old-secret' },
      { ipAddress: '127.0.0.1', userAgent: 'jest' },
    );

    expect(oldSession.revokedAt).toBeInstanceOf(Date);
    expect(oldSession.lastUsedAt).toBe(oldSession.revokedAt);
    expect(response.refreshToken).not.toBe('old-session.old-secret');
    expect(savedSessions).toHaveLength(2);
    expect(savedSessions[1]?.id).not.toBe('old-session');
  });

  it('revokes the matching refresh session on logout', async () => {
    const oldSession = makeSession({
      id: 'old-session',
      refreshTokenHash: 'hashed:old-secret',
      user: makeUser([]),
    });
    const service = makeService({
      findSession: oldSession,
      savedSessions: [],
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
  jwtService?: JwtService;
  findSession?: SessionEntity | null;
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
    findOne: () => Promise.resolve(options.findSession ?? null),
    save: (session: SessionEntity) => {
      options.savedSessions.push(session);
      return Promise.resolve(session);
    },
  } as unknown as Repository<SessionEntity>;

  return new AuthService(
    userRepository,
    sessionRepository,
    makeConfigService(),
    options.jwtService ?? makeJwtService(),
    makePasswordHasher(),
  );
}

function makeConfigService(): ConfigService<EnvironmentVariables, true> {
  const values = {
    JWT_ACCESS_TOKEN_SECRET: 'test-access-secret',
    JWT_ACCESS_TOKEN_TTL_SECONDS: 900,
    JWT_AUDIENCE: 'salidia',
    JWT_ISSUER: 'salidia-api',
    JWT_REFRESH_TOKEN_TTL_SECONDS: 2_592_000,
  };

  return {
    get: (key: keyof typeof values) => values[key],
  } as ConfigService<EnvironmentVariables, true>;
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
  id: string;
  refreshTokenHash: string;
  user: UserEntity;
}): SessionEntity {
  return Object.assign(new SessionEntity(), {
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    id: options.id,
    ipAddress: null,
    lastUsedAt: null,
    refreshTokenHash: options.refreshTokenHash,
    revokedAt: null,
    user: options.user,
    userAgent: null,
    userId: options.user.id,
  });
}
