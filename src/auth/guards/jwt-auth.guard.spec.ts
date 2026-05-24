import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';

import { EnvironmentVariables } from '../../config/environment.validation';
import { SessionEntity } from '../../database/entities/session.entity';
import { UserRole } from '../../domain/enums';
import { AuthenticatedRequest } from '../types/authenticated-principal';
import { JwtAuthGuard } from './jwt-auth.guard';

type ExistsFn = (query: unknown) => Promise<boolean>;
type ExistsQuery = { where: { id: unknown; userId: unknown } };

describe(JwtAuthGuard.name, () => {
  it('accepts bearer tokens with an active server-side session', async () => {
    const payload = makePayload({ sessionId: 'session-1' });
    const exists = makeExists(true);
    const request = makeRequest();
    const guard = makeGuard({ exists, payload });

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);

    expect(request.auth).toEqual(payload);
    expect(exists).toHaveBeenCalledTimes(1);
    expect(getExistsQuery(exists).where.id).toBe('session-1');
    expect(getExistsQuery(exists).where.userId).toBe('user-1');
  });

  it('rejects bearer tokens whose session has been revoked or expired', async () => {
    const exists = makeExists(false);
    const guard = makeGuard({
      exists,
      payload: makePayload({ sessionId: 'revoked-session' }),
    });

    await expect(guard.canActivate(makeContext(makeRequest()))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('keeps accepting legacy bearer tokens without a session id', async () => {
    const exists = makeExists(false);
    const request = makeRequest();
    const guard = makeGuard({ exists, payload: makePayload() });

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);

    expect(exists).not.toHaveBeenCalled();
  });
});

function makeGuard(options: {
  exists: ExistsFn;
  payload: Record<string, unknown>;
}): JwtAuthGuard {
  const configService = {
    get: (key: keyof EnvironmentVariables) => {
      const values: Partial<Record<keyof EnvironmentVariables, string>> = {
        JWT_ACCESS_TOKEN_SECRET: 'test-access-secret',
        JWT_AUDIENCE: 'regihora',
        JWT_ISSUER: 'regihora-api',
      };

      return values[key];
    },
  } as ConfigService<EnvironmentVariables, true>;
  const jwtService = {
    verifyAsync: jest.fn().mockResolvedValue(options.payload),
  } as unknown as JwtService;
  const sessionRepository = {
    exists: options.exists,
  } as unknown as Repository<SessionEntity>;

  return new JwtAuthGuard(configService, jwtService, sessionRepository);
}

function makeExists(value: boolean): jest.MockedFunction<ExistsFn> {
  return jest.fn((query: unknown) => {
    void query;

    return Promise.resolve(value);
  });
}

function getExistsQuery(exists: jest.MockedFunction<ExistsFn>): ExistsQuery {
  const firstCall = exists.mock.calls[0];

  if (firstCall === undefined) {
    throw new Error('Expected session repository lookup.');
  }

  return firstCall[0] as ExistsQuery;
}

function makePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    email: 'ana@example.com',
    memberships: [
      {
        employeeId: 'employee-a',
        roles: [UserRole.EMPLOYEE],
        tenantId: 'tenant-a',
      },
    ],
    roles: [UserRole.EMPLOYEE],
    sub: 'user-1',
    ...overrides,
  };
}

function makeContext(request: AuthenticatedRequest): ExecutionContext {
  return {
    getClass: jest.fn(),
    getHandler: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

function makeRequest(): AuthenticatedRequest {
  return {
    headers: {
      authorization: 'Bearer access-token',
    },
  } as AuthenticatedRequest;
}
