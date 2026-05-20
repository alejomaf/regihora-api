import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test as NestTest, type TestingModule } from '@nestjs/testing';
import request, { type Response, type Test } from 'supertest';
import { DataSource, type Repository } from 'typeorm';

import type { AttendanceAdjustmentDto } from '../src/adjustments/dto/adjustment.dto';
import type { AttendancePunchDto } from '../src/attendance/dto/attendance-punch.dto';
import type { AttendancePolicyDto } from '../src/attendance-policies/dto/attendance-policy.dto';
import type { AuthResponseDto } from '../src/auth/dto/auth-response.dto';
import { PasswordHasher } from '../src/auth/password/password-hasher.service';
import { validateEnvironment } from '../src/config/environment.validation';
import {
  EmployeeEntity,
  TenantEntity,
  UserEntity,
} from '../src/database/entities';
import { createDataSourceOptions } from '../src/database/typeorm-options';
import {
  AdjustmentStatus,
  AttendancePolicyMode,
  AttendanceSource,
  DeviceStatus,
  DeviceType,
  EmployeeStatus,
  PunchAction,
  ReportFormat,
  ResourceStatus,
  TenantPlan,
  UserRole,
  WorkMode,
} from '../src/domain/enums';
import type {
  DepartmentDto,
  EmployeeCsvImportResponseDto,
  EmployeeDto,
  EmployeeInvitationDto,
  PaginatedResponseDto,
  WorkplaceDto,
} from '../src/organization/dto/organization.dto';
import type {
  QrChallengeDto,
  QrDeviceDto,
  QrDeviceEnrollmentDto,
  QrDeviceEnrollmentTokenDto,
  QrDeviceHeartbeatDto,
} from '../src/qr-devices/dto/qr-device.dto';

const runDatabaseE2e = process.env.SALIDIA_E2E_DATABASE === 'true';
const describeDatabaseE2e = runDatabaseE2e ? describe : describe.skip;
const tenantHeader = 'X-Salidia-Tenant-Id';
const deviceTokenHeader = 'X-Salidia-Device-Token';
const qaDatabaseName = process.env.SALIDIA_E2E_DATABASE_NAME ?? 'salidia_qa_e2e';
const qaPassword = 'Qa-password-1';

type TestServer = Parameters<typeof request>[0];

type QaUserKey = 'auditor' | 'employee' | 'manager' | 'owner' | 'ownerB';

type QaSeed = {
  employees: Record<QaUserKey, EmployeeEntity>;
  tenants: {
    a: TenantEntity;
    b: TenantEntity;
  };
};

type QaContext = {
  app: INestApplication;
  dataSource: DataSource;
  employeeRepository: Repository<EmployeeEntity>;
  passwordHasher: PasswordHasher;
  seed: QaSeed;
  server: TestServer;
  userRepository: Repository<UserEntity>;
};

type QaCoverageEntry = {
  operationId: string;
};

const coveredOperations = new Set<string>();

describeDatabaseE2e('QA OpenAPI matrix e2e', () => {
  let context: QaContext | null = null;

  beforeAll(async () => {
    setDatabaseE2eEnvironment();
    await recreateE2eDatabase();
    await runMigrations();

    const { AppModule } = await import('../src/app.module');
    const moduleRef: TestingModule = await NestTest.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    app.useLogger(false);
    await app.init();

    const dataSource = app.get(DataSource);
    const passwordHasher = app.get(PasswordHasher);
    const seed = await createQaSeed(dataSource, passwordHasher);

    context = {
      app,
      dataSource,
      employeeRepository: dataSource.getRepository(EmployeeEntity),
      passwordHasher,
      seed,
      server: app.getHttpServer() as TestServer,
      userRepository: dataSource.getRepository(UserEntity),
    };
  });

  afterAll(async () => {
    if (context !== null) {
      await context.app.close();
    }
  });

  it('executes every OpenAPI operation and locks known web/flutter surface gaps', async () => {
    const qa = getContext(context);
    const health = await record(
      'getHealth',
      request(qa.server).get('/health').expect(200),
    );

    expect(responseBody(health)).toEqual(
      expect.objectContaining({
        service: 'salidia-api',
        status: 'ok',
      }),
    );

    await request(qa.server)
      .post('/v1/auth/login')
      .send({ email: 'owner.qa@salidia.test', password: 'wrong-password' })
      .expect(401);

    const ownerAuth = await login(qa.server, 'login', 'owner.qa@salidia.test');
    const ownerBAuth = await login(qa.server, 'login', 'owner-b.qa@salidia.test');
    const managerAuth = await login(qa.server, 'login', 'manager.qa@salidia.test');
    const auditorAuth = await login(qa.server, 'login', 'auditor.qa@salidia.test');
    let employeeAuth = await login(qa.server, 'login', 'employee.qa@salidia.test');

    const refreshedOwnerAuth = await refreshSession(
      qa.server,
      ownerAuth.refreshToken,
    );
    await logout(qa.server, refreshedOwnerAuth.refreshToken);

    const tenantId = qa.seed.tenants.a.id;
    const tenantBId = qa.seed.tenants.b.id;
    const actingOwnerAuth = await login(
      qa.server,
      'login',
      'owner.qa@salidia.test',
    );

    await authorize(
      request(qa.server).get('/v1/employees'),
      actingOwnerAuth,
      tenantBId,
    ).expect(403);
    await request(qa.server).get('/v1/employees').expect(401);
    await authorize(
      request(qa.server).post('/v1/employees'),
      employeeAuth,
      tenantId,
    )
      .send({
        displayName: 'No permitido',
        email: 'forbidden.qa@salidia.test',
        roles: [UserRole.EMPLOYEE],
      })
      .expect(403);

    await authorize(
      request(qa.server).post('/v1/departments'),
      actingOwnerAuth,
      tenantId,
    )
      .send({})
      .expect(400);

    const department = await createDepartment(qa.server, actingOwnerAuth, tenantId);
    const departmentForDelete = await createDepartment(
      qa.server,
      actingOwnerAuth,
      tenantId,
      'Temporal QA',
    );
    await listDepartments(qa.server, auditorAuth, tenantId);
    await getDepartment(qa.server, auditorAuth, tenantId, department.id);
    await updateDepartment(qa.server, actingOwnerAuth, tenantId, department.id);
    await deleteDepartment(
      qa.server,
      actingOwnerAuth,
      tenantId,
      departmentForDelete.id,
    );

    const workplace = await createWorkplace(qa.server, actingOwnerAuth, tenantId);
    const workplaceForDelete = await createWorkplace(
      qa.server,
      actingOwnerAuth,
      tenantId,
      'Centro temporal QA',
    );
    await listWorkplaces(qa.server, auditorAuth, tenantId);
    await getWorkplace(qa.server, auditorAuth, tenantId, workplace.id);
    await updateWorkplace(qa.server, actingOwnerAuth, tenantId, workplace.id);
    await deleteWorkplace(
      qa.server,
      actingOwnerAuth,
      tenantId,
      workplaceForDelete.id,
    );

    const hybridPolicy = await createAttendancePolicy(
      qa.server,
      actingOwnerAuth,
      tenantId,
      workplace.id,
      'Politica hibrida QA',
      AttendancePolicyMode.HYBRID,
    );
    const gpsPolicy = await createAttendancePolicy(
      qa.server,
      actingOwnerAuth,
      tenantId,
      workplace.id,
      'Politica GPS QA',
      AttendancePolicyMode.REMOTE,
      true,
    );
    const policyForDelete = await createAttendancePolicy(
      qa.server,
      actingOwnerAuth,
      tenantId,
      workplace.id,
      'Politica temporal QA',
      AttendancePolicyMode.REMOTE,
    );
    await listAttendancePolicies(qa.server, auditorAuth, tenantId);
    await getAttendancePolicy(qa.server, auditorAuth, tenantId, hybridPolicy.id);
    await updateAttendancePolicy(
      qa.server,
      actingOwnerAuth,
      tenantId,
      hybridPolicy.id,
    );
    await deleteAttendancePolicy(
      qa.server,
      actingOwnerAuth,
      tenantId,
      policyForDelete.id,
    );

    const employeeForCrud = await createEmployee(
      qa.server,
      actingOwnerAuth,
      tenantId,
      {
        attendancePolicyId: hybridPolicy.id,
        departmentId: department.id,
        displayName: 'Empleado CRUD QA',
        email: 'employee-crud.qa@salidia.test',
        roles: [UserRole.EMPLOYEE],
        workplaceId: workplace.id,
      },
    );
    await listEmployees(qa.server, auditorAuth, tenantId);
    await getEmployee(qa.server, auditorAuth, tenantId, employeeForCrud.id);
    await updateEmployee(qa.server, actingOwnerAuth, tenantId, employeeForCrud.id, {
      displayName: 'Empleado CRUD QA actualizado',
      status: EmployeeStatus.ACTIVE,
    });
    await inviteEmployee(qa.server, actingOwnerAuth, tenantId, employeeForCrud.id);
    await deleteEmployee(qa.server, actingOwnerAuth, tenantId, employeeForCrud.id);
    await importEmployeesCsv(
      qa.server,
      actingOwnerAuth,
      tenantId,
      workplace.id,
      department.id,
      hybridPolicy.id,
    );

    await assignEmployeeForAttendance(
      qa,
      qa.seed.employees.employee.id,
      workplace.id,
      hybridPolicy.id,
    );
    employeeAuth = await login(qa.server, 'login', 'employee.qa@salidia.test');

    const remoteClockIn = await punch(qa.server, employeeAuth, tenantId, {
      action: PunchAction.CLOCK_IN,
      employeeId: qa.seed.employees.employee.id,
      idempotencyKey: 'qa-clock-in-idempotent',
      source: AttendanceSource.REMOTE,
    });
    const retriedClockIn = await punch(qa.server, employeeAuth, tenantId, {
      action: PunchAction.CLOCK_IN,
      employeeId: qa.seed.employees.employee.id,
      idempotencyKey: 'qa-clock-in-idempotent',
      source: AttendanceSource.REMOTE,
    });

    expect(retriedClockIn.id).toBe(remoteClockIn.id);

    await authorize(
      request(qa.server).post('/v1/attendance/punch'),
      employeeAuth,
      tenantId,
    )
      .set('Idempotency-Key', `qa-invalid-transition-${randomUUID()}`)
      .send({
        action: PunchAction.CLOCK_IN,
        employeeId: qa.seed.employees.employee.id,
        source: AttendanceSource.REMOTE,
      })
      .expect(409);

    const breakStart = await punch(qa.server, employeeAuth, tenantId, {
      action: PunchAction.BREAK_START,
      employeeId: qa.seed.employees.employee.id,
      idempotencyKey: `qa-break-start-${randomUUID()}`,
      source: AttendanceSource.REMOTE,
    });
    await punch(qa.server, employeeAuth, tenantId, {
      action: PunchAction.BREAK_END,
      employeeId: qa.seed.employees.employee.id,
      idempotencyKey: `qa-break-end-${randomUUID()}`,
      source: AttendanceSource.REMOTE,
    });

    const qrDevice = await createQrDevice(
      qa.server,
      actingOwnerAuth,
      tenantId,
      workplace.id,
    );
    await listQrDevices(qa.server, auditorAuth, tenantId);
    await getQrDevice(qa.server, auditorAuth, tenantId, qrDevice.id);
    await updateQrDevice(qa.server, actingOwnerAuth, tenantId, qrDevice.id);
    const enrollmentToken = await createQrDeviceEnrollmentToken(
      qa.server,
      actingOwnerAuth,
      tenantId,
      qrDevice.id,
    );
    const enrollment = await enrollQrDevice(
      qa.server,
      enrollmentToken.enrollmentToken,
    );
    const heartbeat = await heartbeatQrDevice(
      qa.server,
      qrDevice.id,
      enrollment.deviceToken,
    );
    const challenge = await createQrChallenge(
      qa.server,
      qrDevice.id,
      enrollment.deviceToken,
    );

    expect(heartbeat.status).toBe(DeviceStatus.ACTIVE);

    const qrClockOut = await punch(qa.server, employeeAuth, tenantId, {
      action: PunchAction.CLOCK_OUT,
      employeeId: qa.seed.employees.employee.id,
      idempotencyKey: `qa-qr-clock-out-${randomUUID()}`,
      qrChallenge: challenge,
      source: AttendanceSource.FIXED_DYNAMIC_QR,
      workplaceId: workplace.id,
    });

    expect(qrClockOut.validation.qrChallengeValidated).toBe(true);

    await revokeQrDevice(qa.server, actingOwnerAuth, tenantId, qrDevice.id);

    const gpsEmployee = await createLinkedEmployeeUser(
      qa,
      tenantId,
      'Empleado GPS QA',
      'employee-gps.qa@salidia.test',
      [UserRole.EMPLOYEE],
      {
        attendancePolicyId: gpsPolicy.id,
        departmentId: department.id,
        status: EmployeeStatus.ACTIVE,
        workplaceId: workplace.id,
      },
    );
    const gpsEmployeeAuth = await login(
      qa.server,
      'login',
      'employee-gps.qa@salidia.test',
    );

    await authorize(
      request(qa.server).post('/v1/attendance/punch'),
      gpsEmployeeAuth,
      tenantId,
    )
      .set('Idempotency-Key', `qa-gps-required-${randomUUID()}`)
      .send({
        action: PunchAction.CLOCK_IN,
        employeeId: gpsEmployee.id,
        source: AttendanceSource.REMOTE,
      })
      .expect(400);

    await punch(qa.server, gpsEmployeeAuth, tenantId, {
      action: PunchAction.CLOCK_IN,
      employeeId: gpsEmployee.id,
      idempotencyKey: `qa-gps-clock-in-${randomUUID()}`,
      locationEvidence: {
        accuracyMeters: 10,
        capturedAt: '2026-03-29T01:30:00.000Z',
        latitude: 40.4168,
        longitude: -3.7038,
      },
      source: AttendanceSource.REMOTE,
    });

    const approvedAdjustment = await createAttendanceAdjustment(
      qa.server,
      employeeAuth,
      tenantId,
      qa.seed.employees.employee.id,
      breakStart,
      workplace.id,
    );
    const rejectedAdjustment = await createAttendanceAdjustment(
      qa.server,
      employeeAuth,
      tenantId,
      qa.seed.employees.employee.id,
      remoteClockIn,
      workplace.id,
      'Segunda solicitud QA para rechazo controlado.',
    );

    await listAttendanceAdjustments(qa.server, auditorAuth, tenantId);
    await getAttendanceAdjustment(
      qa.server,
      auditorAuth,
      tenantId,
      approvedAdjustment.id,
    );
    const decidedAdjustment = await approveAttendanceAdjustment(
      qa.server,
      managerAuth,
      tenantId,
      approvedAdjustment.id,
    );
    await rejectAttendanceAdjustment(
      qa.server,
      managerAuth,
      tenantId,
      rejectedAdjustment.id,
    );

    expect(decidedAdjustment.status).toBe(AdjustmentStatus.APPROVED);
    expect(decidedAdjustment.resultingPunchId).toEqual(expect.any(String));

    await exportLegalAttendanceReport(
      qa.server,
      managerAuth,
      tenantId,
      qa.seed.employees.employee.id,
      workplace.id,
      qrClockOut.occurredAt,
      ReportFormat.CSV,
      'text/csv',
    );
    await exportLegalAttendanceReport(
      qa.server,
      managerAuth,
      tenantId,
      qa.seed.employees.employee.id,
      workplace.id,
      qrClockOut.occurredAt,
      ReportFormat.XLSX,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    await exportLegalAttendanceReport(
      qa.server,
      managerAuth,
      tenantId,
      qa.seed.employees.employee.id,
      workplace.id,
      qrClockOut.occurredAt,
      ReportFormat.PDF,
      'application/pdf',
    );

    await authorize(
      request(qa.server).get(`/v1/employees/${employeeForCrud.id}`),
      ownerBAuth,
      tenantBId,
    ).expect(404);

    expect([...coveredOperations].sort()).toEqual(readMatrixOperationIds());
  });

  async function record(operationId: string, test: Test): Promise<Response> {
    const response = await test;

    cover(operationId);

    return response;
  }
});

function setDatabaseE2eEnvironment(): void {
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.DATABASE_ENABLED = 'true';
  process.env.DATABASE_HOST ??= 'localhost';
  process.env.DATABASE_PORT ??= '5432';
  process.env.DATABASE_NAME = qaDatabaseName;
  process.env.DATABASE_USER ??= 'salidia';
  process.env.DATABASE_PASSWORD ??= 'change-me-local-only';
  process.env.DATABASE_SSL ??= 'false';
  process.env.DATABASE_LOGGING ??= 'false';
  process.env.JWT_ACCESS_TOKEN_SECRET = 'test-access-token-secret-for-qa-e2e';
  process.env.JWT_ACCESS_TOKEN_TTL_SECONDS ??= '900';
  process.env.JWT_REFRESH_TOKEN_TTL_SECONDS ??= '2592000';
  process.env.JWT_ISSUER ??= 'salidia-api';
  process.env.JWT_AUDIENCE ??= 'salidia';
}

async function recreateE2eDatabase(): Promise<void> {
  ensureSafeE2eDatabaseName(qaDatabaseName);

  const environment = validateEnvironment(process.env);
  const adminDataSource = new DataSource({
    database: 'postgres',
    host: environment.DATABASE_HOST,
    password: environment.DATABASE_PASSWORD,
    port: environment.DATABASE_PORT,
    ssl: environment.DATABASE_SSL,
    type: 'postgres',
    username: environment.DATABASE_USER,
  });
  const quotedDatabaseName = quotePostgresIdentifier(qaDatabaseName);

  await adminDataSource.initialize();
  try {
    await adminDataSource.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1',
      [qaDatabaseName],
    );
    await adminDataSource.query(`DROP DATABASE IF EXISTS ${quotedDatabaseName}`);
    await adminDataSource.query(`CREATE DATABASE ${quotedDatabaseName}`);
  } finally {
    await adminDataSource.destroy();
  }
}

async function runMigrations(): Promise<void> {
  const environment = validateEnvironment(process.env);
  const dataSource = new DataSource(createDataSourceOptions(environment));

  await dataSource.initialize();
  try {
    await dataSource.runMigrations();
  } finally {
    await dataSource.destroy();
  }
}

async function createQaSeed(
  dataSource: DataSource,
  passwordHasher: PasswordHasher,
): Promise<QaSeed> {
  const tenantRepository = dataSource.getRepository(TenantEntity);
  const tenantA = await tenantRepository.save(
    tenantRepository.create({
      legalName: 'Salidia QA Tenant A SL',
      locale: 'es-ES',
      plan: TenantPlan.BUSINESS,
      taxId: 'BQA000001',
      timezone: 'Europe/Madrid',
    }),
  );
  const tenantB = await tenantRepository.save(
    tenantRepository.create({
      legalName: 'Salidia QA Tenant B SL',
      locale: 'es-ES',
      plan: TenantPlan.ESSENTIAL,
      taxId: 'BQA000002',
      timezone: 'Europe/Madrid',
    }),
  );
  const qaContext = {
    dataSource,
    employeeRepository: dataSource.getRepository(EmployeeEntity),
    passwordHasher,
    userRepository: dataSource.getRepository(UserEntity),
  };
  const owner = await createLinkedEmployeeUser(
    qaContext,
    tenantA.id,
    'Owner QA',
    'owner.qa@salidia.test',
    [UserRole.OWNER],
  );
  const manager = await createLinkedEmployeeUser(
    qaContext,
    tenantA.id,
    'Manager QA',
    'manager.qa@salidia.test',
    [UserRole.MANAGER],
  );
  const auditor = await createLinkedEmployeeUser(
    qaContext,
    tenantA.id,
    'Auditor QA',
    'auditor.qa@salidia.test',
    [UserRole.AUDITOR],
  );
  const employee = await createLinkedEmployeeUser(
    qaContext,
    tenantA.id,
    'Empleado QA',
    'employee.qa@salidia.test',
    [UserRole.EMPLOYEE],
  );
  const ownerB = await createLinkedEmployeeUser(
    qaContext,
    tenantB.id,
    'Owner QA Tenant B',
    'owner-b.qa@salidia.test',
    [UserRole.OWNER],
  );

  return {
    employees: {
      auditor,
      employee,
      manager,
      owner,
      ownerB,
    },
    tenants: {
      a: tenantA,
      b: tenantB,
    },
  };
}

async function createLinkedEmployeeUser(
  context: Pick<
    QaContext,
    'employeeRepository' | 'passwordHasher' | 'userRepository'
  >,
  tenantId: string,
  displayName: string,
  email: string,
  roles: UserRole[],
  overrides: Partial<{
    attendancePolicyId: string;
    departmentId: string;
    status: EmployeeStatus;
    workplaceId: string;
  }> = {},
): Promise<EmployeeEntity> {
  const user = await context.userRepository.save(
    context.userRepository.create({
      displayName,
      email,
      isActive: true,
      passwordHash: await context.passwordHasher.hash(qaPassword),
    }),
  );

  return context.employeeRepository.save(
    context.employeeRepository.create({
      attendancePolicyId: overrides.attendancePolicyId ?? null,
      departmentId: overrides.departmentId ?? null,
      displayName,
      email,
      roles,
      status: overrides.status ?? EmployeeStatus.ACTIVE,
      tenantId,
      userId: user.id,
      workplaceId: overrides.workplaceId ?? null,
    }),
  );
}

async function assignEmployeeForAttendance(
  context: QaContext,
  employeeId: string,
  workplaceId: string,
  attendancePolicyId: string,
): Promise<void> {
  const employee = await context.employeeRepository.findOneByOrFail({
    id: employeeId,
    tenantId: context.seed.tenants.a.id,
  });

  employee.attendancePolicyId = attendancePolicyId;
  employee.status = EmployeeStatus.ACTIVE;
  employee.workplaceId = workplaceId;
  await context.employeeRepository.save(employee);
}

async function login(
  server: TestServer,
  operationId: 'login',
  email: string,
): Promise<AuthResponseDto> {
  const response = await request(server)
    .post('/v1/auth/login')
    .send({ email, password: qaPassword })
    .expect(200);

  cover(operationId);

  return responseBody(response) as AuthResponseDto;
}

async function refreshSession(
  server: TestServer,
  refreshToken: string,
): Promise<AuthResponseDto> {
  const response = await request(server)
    .post('/v1/auth/refresh')
    .send({ refreshToken })
    .expect(200);

  cover('refreshSession');

  return responseBody(response) as AuthResponseDto;
}

async function logout(server: TestServer, refreshToken: string): Promise<void> {
  await request(server).post('/v1/auth/logout').send({ refreshToken }).expect(204);
  cover('logout');
}

async function createDepartment(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  name = 'Operaciones QA',
): Promise<DepartmentDto> {
  const response = await authorize(request(server).post('/v1/departments'), auth, tenantId)
    .send({ name })
    .expect(201);

  cover('createDepartment');

  return responseBody(response) as DepartmentDto;
}

async function listDepartments(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
): Promise<PaginatedResponseDto<DepartmentDto>> {
  const response = await authorize(request(server).get('/v1/departments'), auth, tenantId)
    .query({ limit: 50, search: 'QA' })
    .expect(200);

  cover('listDepartments');

  return responseBody(response) as PaginatedResponseDto<DepartmentDto>;
}

async function getDepartment(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  departmentId: string,
): Promise<DepartmentDto> {
  const response = await authorize(
    request(server).get(`/v1/departments/${departmentId}`),
    auth,
    tenantId,
  ).expect(200);

  cover('getDepartment');

  return responseBody(response) as DepartmentDto;
}

async function updateDepartment(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  departmentId: string,
): Promise<DepartmentDto> {
  const response = await authorize(
    request(server).patch(`/v1/departments/${departmentId}`),
    auth,
    tenantId,
  )
    .send({ name: 'Operaciones QA Actualizado', status: ResourceStatus.ACTIVE })
    .expect(200);

  cover('updateDepartment');

  return responseBody(response) as DepartmentDto;
}

async function deleteDepartment(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  departmentId: string,
): Promise<void> {
  await authorize(
    request(server).delete(`/v1/departments/${departmentId}`),
    auth,
    tenantId,
  ).expect(204);
  cover('deleteDepartment');
}

async function createWorkplace(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  name = 'Oficina Madrid QA',
): Promise<WorkplaceDto> {
  const response = await authorize(request(server).post('/v1/workplaces'), auth, tenantId)
    .send({ name, timezone: 'Europe/Madrid', type: WorkMode.HYBRID })
    .expect(201);

  cover('createWorkplace');

  return responseBody(response) as WorkplaceDto;
}

async function listWorkplaces(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
): Promise<PaginatedResponseDto<WorkplaceDto>> {
  const response = await authorize(request(server).get('/v1/workplaces'), auth, tenantId)
    .query({ limit: 50, search: 'QA' })
    .expect(200);

  cover('listWorkplaces');

  return responseBody(response) as PaginatedResponseDto<WorkplaceDto>;
}

async function getWorkplace(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  workplaceId: string,
): Promise<WorkplaceDto> {
  const response = await authorize(
    request(server).get(`/v1/workplaces/${workplaceId}`),
    auth,
    tenantId,
  ).expect(200);

  cover('getWorkplace');

  return responseBody(response) as WorkplaceDto;
}

async function updateWorkplace(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  workplaceId: string,
): Promise<WorkplaceDto> {
  const response = await authorize(
    request(server).patch(`/v1/workplaces/${workplaceId}`),
    auth,
    tenantId,
  )
    .send({
      name: 'Oficina Madrid QA Actualizada',
      status: ResourceStatus.ACTIVE,
      timezone: 'Europe/Madrid',
      type: WorkMode.HYBRID,
    })
    .expect(200);

  cover('updateWorkplace');

  return responseBody(response) as WorkplaceDto;
}

async function deleteWorkplace(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  workplaceId: string,
): Promise<void> {
  await authorize(
    request(server).delete(`/v1/workplaces/${workplaceId}`),
    auth,
    tenantId,
  ).expect(204);
  cover('deleteWorkplace');
}

async function createAttendancePolicy(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  workplaceId: string,
  name: string,
  mode: AttendancePolicyMode,
  geolocationRequired = false,
): Promise<AttendancePolicyDto> {
  const response = await authorize(
    request(server).post('/v1/attendance-policies'),
    auth,
    tenantId,
  )
    .send({
      allowedWorkplaceIds: [workplaceId],
      autoCheckout: { afterMinutes: 720, enabled: true },
      geolocationRequired,
      ipAllowlist: [],
      mode,
      name,
    })
    .expect(201);

  cover('createAttendancePolicy');

  return responseBody(response) as AttendancePolicyDto;
}

async function listAttendancePolicies(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
): Promise<PaginatedResponseDto<AttendancePolicyDto>> {
  const response = await authorize(
    request(server).get('/v1/attendance-policies'),
    auth,
    tenantId,
  )
    .query({ limit: 50, search: 'QA' })
    .expect(200);

  cover('listAttendancePolicies');

  return responseBody(response) as PaginatedResponseDto<AttendancePolicyDto>;
}

async function getAttendancePolicy(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  attendancePolicyId: string,
): Promise<AttendancePolicyDto> {
  const response = await authorize(
    request(server).get(`/v1/attendance-policies/${attendancePolicyId}`),
    auth,
    tenantId,
  ).expect(200);

  cover('getAttendancePolicy');

  return responseBody(response) as AttendancePolicyDto;
}

async function updateAttendancePolicy(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  attendancePolicyId: string,
): Promise<AttendancePolicyDto> {
  const response = await authorize(
    request(server).patch(`/v1/attendance-policies/${attendancePolicyId}`),
    auth,
    tenantId,
  )
    .send({
      autoCheckout: { afterMinutes: 720, enabled: true },
      geolocationRequired: false,
      ipAllowlist: [],
      mode: AttendancePolicyMode.HYBRID,
      name: 'Politica hibrida QA Actualizada',
      status: ResourceStatus.ACTIVE,
    })
    .expect(200);

  cover('updateAttendancePolicy');

  return responseBody(response) as AttendancePolicyDto;
}

async function deleteAttendancePolicy(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  attendancePolicyId: string,
): Promise<void> {
  await authorize(
    request(server).delete(`/v1/attendance-policies/${attendancePolicyId}`),
    auth,
    tenantId,
  ).expect(204);
  cover('deleteAttendancePolicy');
}

async function createEmployee(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  body: {
    attendancePolicyId: string;
    departmentId: string;
    displayName: string;
    email: string;
    roles: UserRole[];
    workplaceId: string;
  },
): Promise<EmployeeDto> {
  const response = await authorize(request(server).post('/v1/employees'), auth, tenantId)
    .send(body)
    .expect(201);

  cover('createEmployee');

  return responseBody(response) as EmployeeDto;
}

async function listEmployees(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
): Promise<PaginatedResponseDto<EmployeeDto>> {
  const response = await authorize(request(server).get('/v1/employees'), auth, tenantId)
    .query({ limit: 100, search: 'QA' })
    .expect(200);

  cover('listEmployees');

  return responseBody(response) as PaginatedResponseDto<EmployeeDto>;
}

async function getEmployee(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  employeeId: string,
): Promise<EmployeeDto> {
  const response = await authorize(
    request(server).get(`/v1/employees/${employeeId}`),
    auth,
    tenantId,
  ).expect(200);

  cover('getEmployee');

  return responseBody(response) as EmployeeDto;
}

async function updateEmployee(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  employeeId: string,
  body: Partial<{
    displayName: string;
    status: EmployeeStatus;
  }>,
): Promise<EmployeeDto> {
  const response = await authorize(
    request(server).patch(`/v1/employees/${employeeId}`),
    auth,
    tenantId,
  )
    .send(body)
    .expect(200);

  cover('updateEmployee');

  return responseBody(response) as EmployeeDto;
}

async function deleteEmployee(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  employeeId: string,
): Promise<void> {
  await authorize(
    request(server).delete(`/v1/employees/${employeeId}`),
    auth,
    tenantId,
  ).expect(204);
  cover('deleteEmployee');
}

async function inviteEmployee(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  employeeId: string,
): Promise<EmployeeInvitationDto> {
  const response = await authorize(
    request(server).post(`/v1/employees/${employeeId}/invite`),
    auth,
    tenantId,
  ).expect(201);

  cover('inviteEmployee');

  return responseBody(response) as EmployeeInvitationDto;
}

async function importEmployeesCsv(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  workplaceId: string,
  departmentId: string,
  attendancePolicyId: string,
): Promise<EmployeeCsvImportResponseDto> {
  const csv = [
    'displayName,email,roles,status,workplaceId,departmentId,attendancePolicyId',
    `Empleado Import QA,employee-import.qa@salidia.test,EMPLOYEE,ACTIVE,${workplaceId},${departmentId},${attendancePolicyId}`,
  ].join('\n');
  const response = await authorize(
    request(server).post('/v1/employees/imports'),
    auth,
    tenantId,
  )
    .send({ csv, sendInvitations: false })
    .expect(201);

  cover('importEmployeesCsv');

  return responseBody(response) as EmployeeCsvImportResponseDto;
}

async function punch(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  body: {
    action: PunchAction;
    employeeId: string;
    idempotencyKey: string;
    locationEvidence?: {
      accuracyMeters: number;
      capturedAt: string;
      latitude: number;
      longitude: number;
    };
    qrChallenge?: QrChallengeDto;
    source: AttendanceSource;
    workplaceId?: string;
  },
): Promise<AttendancePunchDto> {
  const response = await authorize(
    request(server).post('/v1/attendance/punch'),
    auth,
    tenantId,
  )
    .set('Idempotency-Key', body.idempotencyKey)
    .send({
      action: body.action,
      deviceContext: {
        locale: 'es-ES',
        timezone: 'Europe/Madrid',
        userAgent: 'salidia-qa-e2e',
      },
      employeeId: body.employeeId,
      locationEvidence: body.locationEvidence,
      qrChallenge: body.qrChallenge,
      source: body.source,
      workplaceId: body.workplaceId,
    })
    .expect(201);

  cover('createAttendancePunch');

  return responseBody(response) as AttendancePunchDto;
}

async function createQrDevice(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  workplaceId: string,
): Promise<QrDeviceDto> {
  const response = await authorize(request(server).post('/v1/devices/qr'), auth, tenantId)
    .send({
      name: 'Kiosco QA',
      rotationSeconds: 60,
      type: DeviceType.FIXED_DYNAMIC_QR,
      workplaceId,
    })
    .expect(201);

  cover('createQrDevice');

  return responseBody(response) as QrDeviceDto;
}

async function listQrDevices(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
): Promise<PaginatedResponseDto<QrDeviceDto>> {
  const response = await authorize(request(server).get('/v1/devices/qr'), auth, tenantId)
    .query({ limit: 50 })
    .expect(200);

  cover('listQrDevices');

  return responseBody(response) as PaginatedResponseDto<QrDeviceDto>;
}

async function getQrDevice(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  qrDeviceId: string,
): Promise<QrDeviceDto> {
  const response = await authorize(
    request(server).get(`/v1/devices/qr/${qrDeviceId}`),
    auth,
    tenantId,
  ).expect(200);

  cover('getQrDevice');

  return responseBody(response) as QrDeviceDto;
}

async function updateQrDevice(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  qrDeviceId: string,
): Promise<QrDeviceDto> {
  const response = await authorize(
    request(server).patch(`/v1/devices/qr/${qrDeviceId}`),
    auth,
    tenantId,
  )
    .send({ name: 'Kiosco QA actualizado', rotationSeconds: 45 })
    .expect(200);

  cover('updateQrDevice');

  return responseBody(response) as QrDeviceDto;
}

async function createQrDeviceEnrollmentToken(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  qrDeviceId: string,
): Promise<QrDeviceEnrollmentTokenDto> {
  const response = await authorize(
    request(server).post(`/v1/devices/qr/${qrDeviceId}/enrollment-token`),
    auth,
    tenantId,
  ).expect(201);

  cover('createQrDeviceEnrollmentToken');

  return responseBody(response) as QrDeviceEnrollmentTokenDto;
}

async function enrollQrDevice(
  server: TestServer,
  enrollmentToken: string,
): Promise<QrDeviceEnrollmentDto> {
  const response = await request(server)
    .post('/v1/devices/qr/enroll')
    .send({ enrollmentToken })
    .expect(200);

  cover('enrollQrDevice');

  return responseBody(response) as QrDeviceEnrollmentDto;
}

async function heartbeatQrDevice(
  server: TestServer,
  qrDeviceId: string,
  deviceToken: string,
): Promise<QrDeviceHeartbeatDto> {
  const response = await request(server)
    .post(`/v1/devices/qr/${qrDeviceId}/heartbeat`)
    .set(deviceTokenHeader, deviceToken)
    .expect(200);

  cover('heartbeatQrDevice');

  return responseBody(response) as QrDeviceHeartbeatDto;
}

async function createQrChallenge(
  server: TestServer,
  qrDeviceId: string,
  deviceToken: string,
): Promise<QrChallengeDto> {
  const response = await request(server)
    .post(`/v1/devices/qr/${qrDeviceId}/challenge`)
    .set(deviceTokenHeader, deviceToken)
    .expect(201);

  cover('createQrChallenge');

  return responseBody(response) as QrChallengeDto;
}

async function revokeQrDevice(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  qrDeviceId: string,
): Promise<QrDeviceDto> {
  const response = await authorize(
    request(server).post(`/v1/devices/qr/${qrDeviceId}/revoke`),
    auth,
    tenantId,
  ).expect(200);

  cover('revokeQrDevice');

  return responseBody(response) as QrDeviceDto;
}

async function createAttendanceAdjustment(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  employeeId: string,
  originalPunch: AttendancePunchDto,
  workplaceId: string,
  reason = 'Solicitud QA de correccion con trazabilidad auditada.',
): Promise<AttendanceAdjustmentDto> {
  const response = await authorize(
    request(server).post('/v1/attendance/adjustments'),
    auth,
    tenantId,
  )
    .send({
      employeeId,
      originalPunchId: originalPunch.id,
      proposedPunch: {
        direction: originalPunch.action,
        occurredAt: originalPunch.occurredAt,
        workplaceId,
      },
      reason,
    })
    .expect(201);

  cover('createAttendanceAdjustment');

  return responseBody(response) as AttendanceAdjustmentDto;
}

async function listAttendanceAdjustments(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
): Promise<PaginatedResponseDto<AttendanceAdjustmentDto>> {
  const response = await authorize(
    request(server).get('/v1/attendance/adjustments'),
    auth,
    tenantId,
  )
    .query({ limit: 100 })
    .expect(200);

  cover('listAttendanceAdjustments');

  return responseBody(response) as PaginatedResponseDto<AttendanceAdjustmentDto>;
}

async function getAttendanceAdjustment(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  adjustmentId: string,
): Promise<AttendanceAdjustmentDto> {
  const response = await authorize(
    request(server).get(`/v1/attendance/adjustments/${adjustmentId}`),
    auth,
    tenantId,
  ).expect(200);

  cover('getAttendanceAdjustment');

  return responseBody(response) as AttendanceAdjustmentDto;
}

async function approveAttendanceAdjustment(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  adjustmentId: string,
): Promise<AttendanceAdjustmentDto> {
  const response = await authorize(
    request(server).post(`/v1/attendance/adjustments/${adjustmentId}/approve`),
    auth,
    tenantId,
  )
    .send({ decisionReason: 'Aprobada por QA.' })
    .expect(201);

  cover('approveAttendanceAdjustment');

  return responseBody(response) as AttendanceAdjustmentDto;
}

async function rejectAttendanceAdjustment(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  adjustmentId: string,
): Promise<AttendanceAdjustmentDto> {
  const response = await authorize(
    request(server).post(`/v1/attendance/adjustments/${adjustmentId}/reject`),
    auth,
    tenantId,
  )
    .send({ decisionReason: 'Rechazada por QA.' })
    .expect(201);

  cover('rejectAttendanceAdjustment');

  return responseBody(response) as AttendanceAdjustmentDto;
}

async function exportLegalAttendanceReport(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  employeeId: string,
  workplaceId: string,
  occurredAt: string,
  format: ReportFormat,
  expectedContentType: string,
): Promise<Response> {
  const response = await authorize(
    request(server).get('/v1/reports/attendance/legal'),
    auth,
    tenantId,
  )
    .query({
      employeeId,
      format,
      from: formatMadridDate(new Date(occurredAt)),
      includeAdjustments: 'true',
      to: formatMadridDate(new Date(occurredAt)),
      workplaceId,
    })
    .expect(200);

  expect(response.headers['content-type']).toContain(expectedContentType);
  expect(response.headers['content-disposition']).toContain(
    'salidia-registro-horario',
  );
  cover('exportLegalAttendanceReport');

  return response;
}

function getContext(context: QaContext | null): QaContext {
  if (context === null) {
    throw new Error('QA e2e context was not initialized.');
  }

  return context;
}

function authorize(test: Test, auth: AuthResponseDto, tenantId: string): Test {
  return test
    .set('Authorization', `${auth.tokenType} ${auth.accessToken}`)
    .set(tenantHeader, tenantId);
}

function responseBody(response: Response): unknown {
  return response.body;
}

function readMatrixOperationIds(): string[] {
  const matrixPath = resolve(
    __dirname,
    '../../salidia-contracts/qa/endpoint-surface-matrix.json',
  );
  const matrix = JSON.parse(readFileSync(matrixPath, 'utf8')) as QaCoverageEntry[];

  return matrix.map((entry) => entry.operationId).sort();
}

function cover(operationId: string): void {
  coveredOperations.add(operationId);
}

function formatMadridDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Madrid',
    year: 'numeric',
  }).format(date);
}

function ensureSafeE2eDatabaseName(databaseName: string): void {
  if (!/^[_a-zA-Z][_a-zA-Z0-9]*$/.test(databaseName)) {
    throw new Error('SALIDIA_E2E_DATABASE_NAME must be a PostgreSQL identifier.');
  }

  if (!/(^|_)e2e($|_)|(^|_)test($|_)/i.test(databaseName)) {
    throw new Error(
      'SALIDIA_E2E_DATABASE_NAME must include "e2e" or "test" because the e2e suite recreates it.',
    );
  }
}

function quotePostgresIdentifier(identifier: string): string {
  ensureSafeE2eDatabaseName(identifier);

  return `"${identifier.replaceAll('"', '""')}"`;
}
