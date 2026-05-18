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
  AttendanceAdjustmentEntity,
  AttendanceEventEntity,
  AuditLogEntity,
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
  TenantPlan,
  UserRole,
  WorkMode,
} from '../src/domain/enums';
import type { EmployeeDto, WorkplaceDto } from '../src/organization/dto/organization.dto';
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
const e2eDatabaseName = process.env.SALIDIA_E2E_DATABASE_NAME ?? 'salidia_e2e';
const ownerPassword = 'Owner-password-1';
const employeePassword = 'Employee-password-1';
const managerPassword = 'Manager-password-1';

type TestServer = Parameters<typeof request>[0];

type FullFlowContext = {
  app: INestApplication;
  dataSource: DataSource;
  employeeRepository: Repository<EmployeeEntity>;
  passwordHasher: PasswordHasher;
  server: TestServer;
  tenant: TenantEntity;
  userRepository: Repository<UserEntity>;
};

describeDatabaseE2e('Full attendance flow e2e', () => {
  let context: FullFlowContext | null = null;

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
    const tenant = await bootstrapInitialOwnerTenant(dataSource, passwordHasher);

    context = {
      app,
      dataSource,
      employeeRepository: dataSource.getRepository(EmployeeEntity),
      passwordHasher,
      server: app.getHttpServer() as TestServer,
      tenant,
      userRepository: dataSource.getRepository(UserEntity),
    };
  });

  afterAll(async () => {
    if (context !== null) {
      await context.app.close();
    }
  });

  it('covers company bootstrap, employee policy assignment, QR device, punches, correction approval, and legal report', async () => {
    const flow = getContext(context);
    const ownerAuth = await login(
      flow.server,
      'owner.flow@salidia.test',
      ownerPassword,
    );

    expect(ownerAuth.memberships).toEqual([
      expect.objectContaining({
        roles: [UserRole.OWNER],
        tenantId: flow.tenant.id,
      }),
    ]);

    const workplace = await createWorkplace(flow.server, ownerAuth, flow.tenant.id);
    const employee = await createEmployee(
      flow.server,
      ownerAuth,
      flow.tenant.id,
      {
        displayName: 'Empleado Flujo Completo',
        email: 'employee.flow@salidia.test',
        roles: [UserRole.EMPLOYEE],
        workplaceId: workplace.id,
      },
    );
    const manager = await createEmployee(
      flow.server,
      ownerAuth,
      flow.tenant.id,
      {
        displayName: 'Manager Flujo Completo',
        email: 'manager.flow@salidia.test',
        roles: [UserRole.MANAGER],
        workplaceId: workplace.id,
      },
    );
    const policy = await createHybridPolicy(
      flow.server,
      ownerAuth,
      flow.tenant.id,
      workplace.id,
    );
    const activeEmployee = await updateEmployee(
      flow.server,
      ownerAuth,
      flow.tenant.id,
      employee.id,
      {
        attendancePolicyId: policy.id,
        status: EmployeeStatus.ACTIVE,
      },
    );
    const activeManager = await updateEmployee(
      flow.server,
      ownerAuth,
      flow.tenant.id,
      manager.id,
      {
        status: EmployeeStatus.ACTIVE,
      },
    );

    await linkEmployeeToLogin(flow, activeEmployee, employeePassword);
    await linkEmployeeToLogin(flow, activeManager, managerPassword);

    const qrDevice = await createQrDevice(
      flow.server,
      ownerAuth,
      flow.tenant.id,
      workplace.id,
    );
    const enrollmentToken = await createEnrollmentToken(
      flow.server,
      ownerAuth,
      flow.tenant.id,
      qrDevice.id,
    );
    const enrollment = await enrollQrDevice(flow.server, enrollmentToken.enrollmentToken);
    const heartbeat = await sendQrHeartbeat(
      flow.server,
      qrDevice.id,
      enrollment.deviceToken,
    );

    expect(enrollment.device.status).toBe(DeviceStatus.ACTIVE);
    expect(heartbeat.status).toBe(DeviceStatus.ACTIVE);

    const employeeAuth = await login(
      flow.server,
      activeEmployee.email,
      employeePassword,
    );
    const remotePunch = await punch(flow.server, employeeAuth, flow.tenant.id, {
      action: PunchAction.CLOCK_IN,
      employeeId: activeEmployee.id,
      source: AttendanceSource.REMOTE,
    });
    const challenge = await createQrChallenge(
      flow.server,
      qrDevice.id,
      enrollment.deviceToken,
    );
    const qrPunch = await punch(flow.server, employeeAuth, flow.tenant.id, {
      action: PunchAction.CLOCK_OUT,
      employeeId: activeEmployee.id,
      qrChallenge: challenge,
      source: AttendanceSource.FIXED_DYNAMIC_QR,
      workplaceId: workplace.id,
    });

    expect(remotePunch.source).toBe(AttendanceSource.REMOTE);
    expect(qrPunch.source).toBe(AttendanceSource.FIXED_DYNAMIC_QR);
    expect(qrPunch.validation.qrChallengeValidated).toBe(true);

    const adjustment = await requestAdjustment(
      flow.server,
      employeeAuth,
      flow.tenant.id,
      activeEmployee.id,
      qrPunch,
      workplace.id,
    );
    const managerAuth = await login(flow.server, activeManager.email, managerPassword);
    const approvedAdjustment = await approveAdjustment(
      flow.server,
      managerAuth,
      flow.tenant.id,
      adjustment.id,
    );

    expect(approvedAdjustment.status).toBe(AdjustmentStatus.APPROVED);
    expect(approvedAdjustment.resultingPunchId).toEqual(expect.any(String));

    const report = await generateLegalCsvReport(
      flow.server,
      managerAuth,
      flow.tenant.id,
      activeEmployee.id,
      workplace.id,
      qrPunch.occurredAt,
    );

    expect(report.headers['content-type']).toContain('text/csv');
    expect(report.headers['content-disposition']).toContain(
      'salidia-registro-horario',
    );
    expect(report.text).toContain('Salidia Full Flow SL');
    expect(report.text).toContain(activeEmployee.displayName);
    expect(report.text).toContain(AttendanceSource.REMOTE);
    expect(report.text).toContain(AttendanceSource.FIXED_DYNAMIC_QR);
    expect(report.text).toContain('AJUSTE');

    await expectAuditTrail(flow.dataSource, flow.tenant.id);
  });
});

function setDatabaseE2eEnvironment(): void {
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.DATABASE_ENABLED = 'true';
  process.env.DATABASE_HOST ??= 'localhost';
  process.env.DATABASE_PORT ??= '5432';
  process.env.DATABASE_NAME = e2eDatabaseName;
  process.env.DATABASE_USER ??= 'salidia';
  process.env.DATABASE_PASSWORD ??= 'change-me-local-only';
  process.env.DATABASE_SSL ??= 'false';
  process.env.DATABASE_LOGGING ??= 'false';
  process.env.JWT_ACCESS_TOKEN_SECRET = 'test-access-token-secret-for-e2e';
  process.env.JWT_ACCESS_TOKEN_TTL_SECONDS ??= '900';
  process.env.JWT_REFRESH_TOKEN_TTL_SECONDS ??= '2592000';
  process.env.JWT_ISSUER ??= 'salidia-api';
  process.env.JWT_AUDIENCE ??= 'salidia';
}

async function recreateE2eDatabase(): Promise<void> {
  ensureSafeE2eDatabaseName(e2eDatabaseName);

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
  const quotedDatabaseName = quotePostgresIdentifier(e2eDatabaseName);

  await adminDataSource.initialize();
  try {
    await adminDataSource.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1',
      [e2eDatabaseName],
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

async function bootstrapInitialOwnerTenant(
  dataSource: DataSource,
  passwordHasher: PasswordHasher,
): Promise<TenantEntity> {
  const tenantRepository = dataSource.getRepository(TenantEntity);
  const userRepository = dataSource.getRepository(UserEntity);
  const employeeRepository = dataSource.getRepository(EmployeeEntity);
  const tenant = await tenantRepository.save(
    tenantRepository.create({
      legalName: 'Salidia Full Flow SL',
      locale: 'es-ES',
      plan: TenantPlan.BUSINESS,
      taxId: 'B00000000',
      timezone: 'Europe/Madrid',
    }),
  );
  const ownerUser = await userRepository.save(
    userRepository.create({
      displayName: 'Owner Flujo Completo',
      email: 'owner.flow@salidia.test',
      isActive: true,
      passwordHash: await passwordHasher.hash(ownerPassword),
    }),
  );

  await employeeRepository.save(
    employeeRepository.create({
      displayName: ownerUser.displayName,
      email: ownerUser.email,
      roles: [UserRole.OWNER],
      status: EmployeeStatus.ACTIVE,
      tenantId: tenant.id,
      userId: ownerUser.id,
    }),
  );

  return tenant;
}

async function login(
  server: TestServer,
  email: string,
  password: string,
): Promise<AuthResponseDto> {
  const response = await request(server)
    .post('/v1/auth/login')
    .send({ email, password })
    .expect(200);

  return responseBody(response) as AuthResponseDto;
}

async function createWorkplace(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
): Promise<WorkplaceDto> {
  const response = await authorize(request(server).post('/v1/workplaces'), auth, tenantId)
    .send({
      name: 'Oficina Madrid',
      timezone: 'Europe/Madrid',
      type: WorkMode.HYBRID,
    })
    .expect(201);

  return responseBody(response) as WorkplaceDto;
}

async function createEmployee(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  body: {
    displayName: string;
    email: string;
    roles: UserRole[];
    workplaceId: string;
  },
): Promise<EmployeeDto> {
  const response = await authorize(request(server).post('/v1/employees'), auth, tenantId)
    .send(body)
    .expect(201);

  return responseBody(response) as EmployeeDto;
}

async function updateEmployee(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  employeeId: string,
  body: Partial<{
    attendancePolicyId: string;
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

  return responseBody(response) as EmployeeDto;
}

async function createHybridPolicy(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  workplaceId: string,
): Promise<AttendancePolicyDto> {
  const response = await authorize(
    request(server).post('/v1/attendance-policies'),
    auth,
    tenantId,
  )
    .send({
      allowedWorkplaceIds: [workplaceId],
      autoCheckout: {
        afterMinutes: 720,
        enabled: true,
      },
      geolocationRequired: false,
      ipAllowlist: [],
      mode: AttendancePolicyMode.HYBRID,
      name: 'Politica hibrida e2e',
    })
    .expect(201);

  return responseBody(response) as AttendancePolicyDto;
}

async function linkEmployeeToLogin(
  context: FullFlowContext,
  employee: EmployeeDto,
  password: string,
): Promise<void> {
  const user = await context.userRepository.save(
    context.userRepository.create({
      displayName: employee.displayName,
      email: employee.email,
      isActive: true,
      passwordHash: await context.passwordHasher.hash(password),
    }),
  );
  const employeeEntity = await context.employeeRepository.findOneByOrFail({
    id: employee.id,
    tenantId: employee.tenantId,
  });

  employeeEntity.status = EmployeeStatus.ACTIVE;
  employeeEntity.userId = user.id;
  await context.employeeRepository.save(employeeEntity);
}

async function createQrDevice(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  workplaceId: string,
): Promise<QrDeviceDto> {
  const response = await authorize(request(server).post('/v1/devices/qr'), auth, tenantId)
    .send({
      name: 'Kiosco entrada principal',
      rotationSeconds: 60,
      type: DeviceType.FIXED_DYNAMIC_QR,
      workplaceId,
    })
    .expect(201);

  return responseBody(response) as QrDeviceDto;
}

async function createEnrollmentToken(
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

  return responseBody(response) as QrDeviceEnrollmentDto;
}

async function sendQrHeartbeat(
  server: TestServer,
  qrDeviceId: string,
  deviceToken: string,
): Promise<QrDeviceHeartbeatDto> {
  const response = await request(server)
    .post(`/v1/devices/qr/${qrDeviceId}/heartbeat`)
    .set(deviceTokenHeader, deviceToken)
    .expect(200);

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

  return responseBody(response) as QrChallengeDto;
}

async function punch(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  body: {
    action: PunchAction;
    employeeId: string;
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
    .set('Idempotency-Key', `e2e-${body.action}-${randomUUID()}`)
    .send({
      ...body,
      deviceContext: {
        locale: 'es-ES',
        timezone: 'Europe/Madrid',
        userAgent: 'salidia-e2e',
      },
    })
    .expect(201);

  return responseBody(response) as AttendancePunchDto;
}

function getContext(context: FullFlowContext | null): FullFlowContext {
  if (context === null) {
    throw new Error('E2E context was not initialized.');
  }

  return context;
}

async function requestAdjustment(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  employeeId: string,
  originalPunch: AttendancePunchDto,
  workplaceId: string,
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
        direction: PunchAction.CLOCK_OUT,
        occurredAt: originalPunch.occurredAt,
        workplaceId,
      },
      reason: 'Ajustar salida registrada desde QR durante el flujo e2e.',
    })
    .expect(201);

  return responseBody(response) as AttendanceAdjustmentDto;
}

async function approveAdjustment(
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
    .send({
      decisionReason: 'Correccion aprobada en prueba e2e.',
    })
    .expect(201);

  return responseBody(response) as AttendanceAdjustmentDto;
}

async function generateLegalCsvReport(
  server: TestServer,
  auth: AuthResponseDto,
  tenantId: string,
  employeeId: string,
  workplaceId: string,
  occurredAt: string,
): Promise<Response> {
  const localDate = formatMadridDate(new Date(occurredAt));

  return authorize(request(server).get('/v1/reports/attendance/legal'), auth, tenantId)
    .query({
      employeeId,
      format: ReportFormat.CSV,
      from: localDate,
      includeAdjustments: 'true',
      to: localDate,
      workplaceId,
    })
    .expect(200);
}

async function expectAuditTrail(
  dataSource: DataSource,
  tenantId: string,
): Promise<void> {
  const auditLogRepository = dataSource.getRepository(AuditLogEntity);
  const eventRepository = dataSource.getRepository(AttendanceEventEntity);
  const adjustmentRepository = dataSource.getRepository(AttendanceAdjustmentEntity);
  const actions = (
    await auditLogRepository.find({
      order: {
        occurredAt: 'ASC',
      },
      where: {
        tenantId,
      },
    })
  ).map((auditLog) => auditLog.action);

  expect(actions).toEqual(
    expect.arrayContaining([
      'adjustment.requested',
      'adjustment.approved',
      'attendance_event.created_from_adjustment',
      'attendance_report.exported',
    ]),
  );
  await expect(eventRepository.countBy({ tenantId })).resolves.toBeGreaterThanOrEqual(3);
  await expect(adjustmentRepository.countBy({ tenantId })).resolves.toBe(1);
}

function authorize(test: Test, auth: AuthResponseDto, tenantId: string): Test {
  return test
    .set('Authorization', `${auth.tokenType} ${auth.accessToken}`)
    .set(tenantHeader, tenantId);
}

function responseBody(response: Response): unknown {
  return response.body;
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
