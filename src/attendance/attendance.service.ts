import { createHash, timingSafeEqual } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AttendanceEventEntity } from '../database/entities/attendance-event.entity';
import { AttendancePolicyEntity } from '../database/entities/attendance-policy.entity';
import { DeviceEntity } from '../database/entities/device.entity';
import { EmployeeEntity } from '../database/entities/employee.entity';
import { TenantEntity } from '../database/entities/tenant.entity';
import { WorkplaceEntity } from '../database/entities/workplace.entity';
import {
  AttendanceEventType,
  AttendancePolicyMode,
  AttendanceSource,
  DeviceStatus,
  DeviceType,
  EmployeeStatus,
  PunchAction,
  ResourceStatus,
} from '../domain/enums';
import {
  getQrChallengeId,
  isQrChallengeSignatureValid,
} from '../qr-devices/qr-challenge';
import type { QrChallengePayload } from '../qr-devices/qr-challenge';
import { CurrentTenantContext } from '../tenancy/types/current-tenant';
import { toAttendancePunchDto } from './attendance.mapper';
import {
  AttendancePunchCreateRequestDto,
  AttendancePunchDto,
  DeviceContextDto,
  LocationEvidenceDto,
  TurnstilePunchCreateRequestDto,
} from './dto/attendance-punch.dto';
import { isIpAllowed } from './ip-allowlist';

type PunchContext = {
  currentTenant: CurrentTenantContext;
  idempotencyKey: string;
  ipAddress: string | null;
  userAgent: string | null;
};

type ParsedPunchRequest = {
  employeeId: string;
  action: PunchAction;
  source: AttendanceSource;
  workplaceId: string | null;
  qrChallengeToken: string | null;
  qrChallenge: QrChallengePayload | null;
  locationEvidence: LocationEvidenceDto | null;
  deviceContext: DeviceContextDto;
};

type AttendanceSessionState = {
  clockedIn: boolean;
  onBreak: boolean;
};

type ValidatedQrChallenge = {
  challenge: QrChallengePayload;
  challengeId: string;
  device: DeviceEntity;
};

type TurnstilePunchHttpContext = {
  ipAddress: string | null;
  userAgent: string | null;
};

type ParsedTurnstilePunchRequest = {
  scannedCode: string;
  scanId: string;
  deviceContext: DeviceContextDto;
};

const allowedSourcesByMode: Record<AttendancePolicyMode, AttendanceSource[]> = {
  [AttendancePolicyMode.HYBRID]: [
    AttendanceSource.REMOTE,
    AttendanceSource.IN_PERSON,
    AttendanceSource.FIXED_DYNAMIC_QR,
  ],
  [AttendancePolicyMode.ONSITE_QR]: [
    AttendanceSource.IN_PERSON,
    AttendanceSource.FIXED_DYNAMIC_QR,
  ],
  [AttendancePolicyMode.REMOTE]: [AttendanceSource.REMOTE],
};

@Injectable()
export class AttendanceService {
  constructor(
    @InjectRepository(AttendanceEventEntity)
    private readonly attendanceEventRepository: Repository<AttendanceEventEntity>,
    @InjectRepository(EmployeeEntity)
    private readonly employeeRepository: Repository<EmployeeEntity>,
    @InjectRepository(AttendancePolicyEntity)
    private readonly policyRepository: Repository<AttendancePolicyEntity>,
    @InjectRepository(DeviceEntity)
    private readonly deviceRepository: Repository<DeviceEntity>,
    @InjectRepository(TenantEntity)
    private readonly tenantRepository: Repository<TenantEntity>,
    @InjectRepository(WorkplaceEntity)
    private readonly workplaceRepository: Repository<WorkplaceEntity>,
  ) {}

  async punch(
    request: AttendancePunchCreateRequestDto,
    context: PunchContext,
  ): Promise<AttendancePunchDto> {
    const parsedRequest = parsePunchRequest(request);
    const fingerprint = getPunchFingerprint(parsedRequest);
    const existingEvent = await this.findExistingIdempotentEvent(
      context.currentTenant.tenantId,
      context.currentTenant.userId,
      context.idempotencyKey,
    );

    if (existingEvent !== null) {
      if (existingEvent.metadata.idempotencyFingerprint !== fingerprint) {
        throw new ConflictException('Idempotency key was already used.');
      }

      return toAttendancePunchDto(existingEvent);
    }

    this.ensurePunchBelongsToCurrentSession(parsedRequest, context.currentTenant);

    const employee = await this.getActiveEmployee(
      context.currentTenant.tenantId,
      parsedRequest.employeeId,
    );
    const tenant = await this.getTenant(context.currentTenant.tenantId);
    const policy = await this.getActivePolicy(
      context.currentTenant.tenantId,
      employee.attendancePolicyId,
    );
    const workplace = await this.getValidatedWorkplace(
      context.currentTenant.tenantId,
      parsedRequest,
      policy,
    );
    const expectedTimezone = workplace?.timezone ?? tenant.timezone;

    validateTimezone(expectedTimezone, 'tenant/workplace timezone');
    validateDeviceTimezone(parsedRequest.deviceContext.timezone, expectedTimezone);
    this.validateSource(policy, parsedRequest.source);
    this.validateGeolocation(policy, parsedRequest.locationEvidence);
    this.validateIpAllowlist(policy, context.ipAddress);
    const qrChallenge = await this.validateQrChallenge(
      context.currentTenant.tenantId,
      parsedRequest,
      workplace,
    );
    await this.validateAttendanceSession(
      context.currentTenant.tenantId,
      parsedRequest.employeeId,
      parsedRequest.action,
    );

    const now = new Date();
    const event = this.attendanceEventRepository.create({
      action: parsedRequest.action,
      createdByUserId: context.currentTenant.userId,
      deviceId: qrChallenge?.device.id ?? null,
      employeeId: parsedRequest.employeeId,
      eventType: AttendanceEventType.PUNCH,
      gpsProvided: parsedRequest.locationEvidence !== null,
      gpsRequiredByPolicy: policy.geolocationRequired,
      idempotencyKey: context.idempotencyKey,
      metadata: {
        deviceContext: parsedRequest.deviceContext,
        idempotencyFingerprint: fingerprint,
        ipAddress: context.ipAddress,
        localDate: formatLocalDate(now, expectedTimezone),
        policyId: policy.id,
        qrChallenge: qrChallenge?.challenge ?? null,
        timezone: expectedTimezone,
        userAgent: context.userAgent,
      },
      occurredAt: now,
      qrChallengeId: qrChallenge?.challengeId ?? null,
      source: parsedRequest.source,
      tenantId: context.currentTenant.tenantId,
      workplaceId: workplace?.id ?? null,
    });

    return toAttendancePunchDto(await this.attendanceEventRepository.save(event));
  }

  async turnstilePunch(
    qrDeviceId: string,
    deviceToken: unknown,
    request: TurnstilePunchCreateRequestDto,
    context: TurnstilePunchHttpContext,
  ): Promise<AttendancePunchDto> {
    const parsedRequest = parseTurnstilePunchRequest(request);
    const device = await this.getActiveTurnstileDeviceByToken(qrDeviceId, deviceToken);
    const employee = await this.getActiveEmployeeByTurnstileCode(
      device.tenantId,
      parsedRequest.scannedCode,
    );

    if (employee.userId === null) {
      throw new ForbiddenException('Employee has no user account for attendance punches.');
    }

    const idempotencyKey = getTurnstileIdempotencyKey(device.id, parsedRequest.scanId);
    const fingerprint = getTurnstilePunchFingerprint(device.id, parsedRequest);
    const existingEvent = await this.findExistingIdempotentEvent(
      device.tenantId,
      employee.userId,
      idempotencyKey,
    );

    if (existingEvent !== null) {
      if (existingEvent.metadata.idempotencyFingerprint !== fingerprint) {
        throw new ConflictException('Idempotency key was already used.');
      }

      return toAttendancePunchDto(existingEvent);
    }

    await this.getTenant(device.tenantId);
    const policy = await this.getActivePolicy(device.tenantId, employee.attendancePolicyId);
    const workplace = await this.getValidatedWorkplace(
      device.tenantId,
      {
        action: PunchAction.CLOCK_IN,
        deviceContext: parsedRequest.deviceContext,
        employeeId: employee.id,
        locationEvidence: null,
        qrChallenge: null,
        qrChallengeToken: null,
        source: AttendanceSource.IN_PERSON,
        workplaceId: device.workplaceId,
      },
      policy,
    );

    if (workplace === null) {
      throw new NotFoundException('Turnstile workplace not found.');
    }

    const expectedTimezone = workplace.timezone;

    validateTimezone(expectedTimezone, 'tenant/workplace timezone');
    validateDeviceTimezone(parsedRequest.deviceContext.timezone, expectedTimezone);
    this.validateSource(policy, AttendanceSource.IN_PERSON);
    this.validateGeolocation(policy, null, true);
    this.validateIpAllowlist(policy, context.ipAddress);

    const lastEvent = await this.getLastPunchEvent(device.tenantId, employee.id);
    const action = getNextTurnstileAction(getAttendanceSessionState(lastEvent?.action));
    const now = new Date();
    const event = this.attendanceEventRepository.create({
      action,
      createdByUserId: employee.userId,
      deviceId: device.id,
      employeeId: employee.id,
      eventType: AttendanceEventType.PUNCH,
      gpsProvided: false,
      gpsRequiredByPolicy: false,
      idempotencyKey,
      metadata: {
        deviceContext: parsedRequest.deviceContext,
        idempotencyFingerprint: fingerprint,
        ipAddress: context.ipAddress,
        localDate: formatLocalDate(now, expectedTimezone),
        policyId: policy.id,
        timezone: expectedTimezone,
        turnstile: {
          devicePublicId: device.publicId,
          scanId: parsedRequest.scanId,
          scannedCodeHash: hashTurnstileCode(parsedRequest.scannedCode),
        },
        userAgent: context.userAgent,
      },
      occurredAt: now,
      qrChallengeId: null,
      source: AttendanceSource.IN_PERSON,
      tenantId: device.tenantId,
      workplaceId: workplace.id,
    });

    return toAttendancePunchDto(await this.attendanceEventRepository.save(event));
  }

  private async findExistingIdempotentEvent(
    tenantId: string,
    userId: string,
    idempotencyKey: string,
  ): Promise<AttendanceEventEntity | null> {
    return this.attendanceEventRepository.findOneBy({
      createdByUserId: userId,
      idempotencyKey,
      tenantId,
    });
  }

  private ensurePunchBelongsToCurrentSession(
    request: ParsedPunchRequest,
    currentTenant: CurrentTenantContext,
  ): void {
    if (request.employeeId !== currentTenant.employeeId) {
      throw new ForbiddenException('Cannot punch for another employee session.');
    }
  }

  private async getActiveEmployee(
    tenantId: string,
    employeeId: string,
  ): Promise<EmployeeEntity> {
    const employee = await this.employeeRepository.findOneBy({
      id: employeeId,
      tenantId,
    });

    if (employee?.status !== EmployeeStatus.ACTIVE) {
      throw new ForbiddenException('Employee session is not active.');
    }

    return employee;
  }

  private async getActiveEmployeeByTurnstileCode(
    tenantId: string,
    scannedCode: string,
  ): Promise<EmployeeEntity> {
    const employee = await this.employeeRepository.findOneBy({
      tenantId,
      turnstileCodeHash: hashTurnstileCode(scannedCode),
    });

    if (employee?.status !== EmployeeStatus.ACTIVE) {
      throw new ForbiddenException('Turnstile credential is not active.');
    }

    return employee;
  }

  private async getActiveTurnstileDeviceByToken(
    qrDeviceId: string,
    deviceToken: unknown,
  ): Promise<DeviceEntity & { deviceTokenHash: string }> {
    const parsedDeviceToken = parseRequiredString(
      deviceToken,
      'X-Regihora-Device-Token',
      256,
    );
    const device = await this.deviceRepository.findOneBy({ id: qrDeviceId });

    if (device === null) {
      throw new NotFoundException('Turnstile device not found.');
    }

    if (
      device.deviceTokenHash === null ||
      !secretsMatch(hashSecret(parsedDeviceToken), device.deviceTokenHash)
    ) {
      throw new UnauthorizedException('Invalid device token.');
    }

    if (device.status !== DeviceStatus.ACTIVE) {
      throw new ConflictException('Turnstile device is not active.');
    }

    if (device.type !== DeviceType.TURNSTILE) {
      throw new ConflictException('Device is not configured as a turnstile.');
    }

    return device as DeviceEntity & { deviceTokenHash: string };
  }

  private async getTenant(tenantId: string): Promise<TenantEntity> {
    const tenant = await this.tenantRepository.findOneBy({ id: tenantId });

    if (tenant === null) {
      throw new NotFoundException('Tenant not found.');
    }

    return tenant;
  }

  private async getActivePolicy(
    tenantId: string,
    policyId: string | null,
  ): Promise<AttendancePolicyEntity> {
    if (policyId === null) {
      throw new ForbiddenException('Employee has no attendance policy.');
    }

    const policy = await this.policyRepository.findOneBy({
      id: policyId,
      tenantId,
    });

    if (policy?.status !== ResourceStatus.ACTIVE) {
      throw new ForbiddenException('Attendance policy is not active.');
    }

    return policy;
  }

  private async getValidatedWorkplace(
    tenantId: string,
    request: ParsedPunchRequest,
    policy: AttendancePolicyEntity,
  ): Promise<WorkplaceEntity | null> {
    if (request.source === AttendanceSource.IN_PERSON && request.workplaceId === null) {
      throw new BadRequestException('workplaceId is required for IN_PERSON punches.');
    }

    if (request.source === AttendanceSource.FIXED_DYNAMIC_QR && request.workplaceId === null) {
      throw new BadRequestException('workplaceId is required for ONSITE_QR punches.');
    }

    if (request.source === AttendanceSource.FIXED_DYNAMIC_QR && request.qrChallenge === null) {
      throw new BadRequestException('qrChallenge is required for ONSITE_QR punches.');
    }

    if (request.workplaceId === null) {
      return null;
    }

    const workplace = await this.workplaceRepository.findOneBy({
      id: request.workplaceId,
      tenantId,
    });

    if (workplace?.status !== ResourceStatus.ACTIVE) {
      throw new NotFoundException('Workplace not found.');
    }

    if (
      policy.allowedWorkplaceIds.length > 0 &&
      !policy.allowedWorkplaceIds.includes(workplace.id)
    ) {
      throw new ForbiddenException('Workplace is not allowed by policy.');
    }

    return workplace;
  }

  private validateSource(
    policy: AttendancePolicyEntity,
    source: AttendanceSource,
  ): void {
    const allowedSources = allowedSourcesByMode[policy.mode];

    if (!allowedSources.includes(source)) {
      throw new ForbiddenException('Punch source is not allowed by policy.');
    }
  }

  private validateGeolocation(
    policy: AttendancePolicyEntity,
    locationEvidence: LocationEvidenceDto | null,
    trustedWorkplaceDevice = false,
  ): void {
    if (trustedWorkplaceDevice) {
      return;
    }

    if (policy.geolocationRequired && locationEvidence === null) {
      throw new BadRequestException('locationEvidence is required by policy.');
    }
  }

  private validateIpAllowlist(
    policy: AttendancePolicyEntity,
    ipAddress: string | null,
  ): void {
    if (policy.ipAllowlist.length === 0) {
      return;
    }

    if (ipAddress === null || !isIpAllowed(ipAddress, policy.ipAllowlist)) {
      throw new ForbiddenException('IP address is not allowed by policy.');
    }
  }

  private async validateAttendanceSession(
    tenantId: string,
    employeeId: string,
    action: PunchAction,
  ): Promise<void> {
    const lastEvent = await this.getLastPunchEvent(tenantId, employeeId);
    const state = getAttendanceSessionState(lastEvent?.action);

    if (!isActionAllowedForState(action, state)) {
      throw new ConflictException('Punch action is not valid for the current session.');
    }
  }

  private async getLastPunchEvent(
    tenantId: string,
    employeeId: string,
  ): Promise<AttendanceEventEntity | null> {
    return this.attendanceEventRepository.findOne({
      order: {
        occurredAt: 'DESC',
      },
      where: {
        employeeId,
        eventType: AttendanceEventType.PUNCH,
        tenantId,
      },
    });
  }

  private async validateQrChallenge(
    tenantId: string,
    request: ParsedPunchRequest,
    workplace: WorkplaceEntity | null,
  ): Promise<ValidatedQrChallenge | null> {
    if (request.source !== AttendanceSource.FIXED_DYNAMIC_QR) {
      return null;
    }

    if (request.qrChallenge === null) {
      throw new BadRequestException('qrChallenge is required for ONSITE_QR punches.');
    }

    if (workplace === null) {
      throw new BadRequestException('workplaceId is required for ONSITE_QR punches.');
    }

    const device = await this.deviceRepository.findOneBy({
      publicId: request.qrChallenge.devicePublicId,
      tenantId,
      type: DeviceType.FIXED_DYNAMIC_QR,
    });

    if (device === null) {
      throw new NotFoundException('QR device not found.');
    }

    if (device.status !== DeviceStatus.ACTIVE || device.deviceTokenHash === null) {
      throw new ConflictException('QR device is not active.');
    }

    if (device.workplaceId !== workplace.id) {
      throw new ForbiddenException('QR device does not belong to the selected workplace.');
    }

    validateQrChallengeWindow(request.qrChallenge, device.rotationSeconds);

    if (!isQrChallengeSignatureValid(request.qrChallenge, device.deviceTokenHash)) {
      throw new ForbiddenException('QR challenge signature is invalid.');
    }

    const challengeId = getQrChallengeId(request.qrChallenge);
    const existingEvent = await this.attendanceEventRepository.findOneBy({
      qrChallengeId: challengeId,
      tenantId,
    });

    if (existingEvent !== null) {
      throw new ConflictException('QR challenge nonce was already used.');
    }

    return {
      challenge: request.qrChallenge,
      challengeId,
      device,
    };
  }
}

function parsePunchRequest(
  request: AttendancePunchCreateRequestDto,
): ParsedPunchRequest {
  return {
    action: parseEnum(request.action, PunchAction, 'action'),
    deviceContext: parseDeviceContext(request.deviceContext),
    employeeId: parseRequiredString(request.employeeId, 'employeeId', 80),
    locationEvidence: parseLocationEvidence(request.locationEvidence),
    qrChallengeToken: parseOptionalString(
      request.qrChallengeToken,
      'qrChallengeToken',
      512,
    ),
    qrChallenge: parseQrChallenge(request.qrChallenge),
    source: parseEnum(request.source, AttendanceSource, 'source'),
    workplaceId: parseOptionalString(request.workplaceId, 'workplaceId', 80),
  };
}

function parseTurnstilePunchRequest(
  request: TurnstilePunchCreateRequestDto,
): ParsedTurnstilePunchRequest {
  return {
    deviceContext: parseDeviceContext(request.deviceContext),
    scanId: parseRequiredString(request.scanId, 'scanId', 80),
    scannedCode: parseRequiredString(request.scannedCode, 'scannedCode', 512),
  };
}

function parseLocationEvidence(value: unknown): LocationEvidenceDto | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isRecord(value)) {
    throw new BadRequestException('locationEvidence must be an object.');
  }

  const latitude = parseNumber(value.latitude, 'locationEvidence.latitude');
  const longitude = parseNumber(value.longitude, 'locationEvidence.longitude');
  const accuracyMeters = parseNumber(
    value.accuracyMeters,
    'locationEvidence.accuracyMeters',
  );
  const capturedAt = parseRequiredString(
    value.capturedAt,
    'locationEvidence.capturedAt',
    80,
  );

  if (latitude < -90 || latitude > 90) {
    throw new BadRequestException('locationEvidence.latitude is out of range.');
  }

  if (longitude < -180 || longitude > 180) {
    throw new BadRequestException('locationEvidence.longitude is out of range.');
  }

  if (accuracyMeters < 0) {
    throw new BadRequestException('locationEvidence.accuracyMeters is out of range.');
  }

  if (Number.isNaN(Date.parse(capturedAt))) {
    throw new BadRequestException('locationEvidence.capturedAt must be a date-time.');
  }

  return {
    accuracyMeters,
    capturedAt,
    latitude,
    longitude,
  };
}

function parseQrChallenge(value: unknown): QrChallengePayload | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isRecord(value)) {
    throw new BadRequestException('qrChallenge must be an object.');
  }

  const challenge = {
    devicePublicId: parseRequiredString(
      value.devicePublicId,
      'qrChallenge.devicePublicId',
      64,
    ),
    expiresAt: parseRequiredString(value.expiresAt, 'qrChallenge.expiresAt', 80),
    issuedAt: parseRequiredString(value.issuedAt, 'qrChallenge.issuedAt', 80),
    nonce: parseRequiredString(value.nonce, 'qrChallenge.nonce', 128),
    signature: parseRequiredString(
      value.signature,
      'qrChallenge.signature',
      64,
    ),
  };

  if (challenge.devicePublicId.length < 12) {
    throw new BadRequestException('qrChallenge.devicePublicId is too short.');
  }

  if (challenge.nonce.length < 16) {
    throw new BadRequestException('qrChallenge.nonce is too short.');
  }

  if (!/^[0-9a-f]{64}$/i.test(challenge.signature)) {
    throw new BadRequestException('qrChallenge.signature must be hex-encoded SHA-256.');
  }

  return challenge;
}

function parseDeviceContext(value: unknown): DeviceContextDto {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isRecord(value)) {
    throw new BadRequestException('deviceContext must be an object.');
  }

  const deviceContext: DeviceContextDto = {};
  const locale = parseOptionalString(value.locale, 'deviceContext.locale', 40);
  const timezone = parseOptionalString(value.timezone, 'deviceContext.timezone', 80);
  const userAgent = parseOptionalString(value.userAgent, 'deviceContext.userAgent', 500);

  if (locale !== null) {
    deviceContext.locale = locale;
  }

  if (timezone !== null) {
    deviceContext.timezone = timezone;
  }

  if (userAgent !== null) {
    deviceContext.userAgent = userAgent;
  }

  return deviceContext;
}

function parseEnum<T extends string>(
  value: unknown,
  enumObject: Record<string, T>,
  name: string,
): T {
  const parsedValue = parseRequiredString(value, name, 80);
  const values = Object.values(enumObject);

  if (!values.includes(parsedValue as T)) {
    throw new BadRequestException(`${name} must be one of: ${values.join(', ')}.`);
  }

  return parsedValue as T;
}

function parseRequiredString(
  value: unknown,
  name: string,
  maxLength: number,
): string {
  const parsedValue = parseOptionalString(value, name, maxLength);

  if (parsedValue === null) {
    throw new BadRequestException(`${name} is required.`);
  }

  return parsedValue;
}

function parseOptionalString(
  value: unknown,
  name: string,
  maxLength: number,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new BadRequestException(`${name} must be a string.`);
  }

  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    return null;
  }

  if (trimmedValue.length > maxLength) {
    throw new BadRequestException(`${name} is too long.`);
  }

  return trimmedValue;
}

function parseNumber(value: unknown, name: string): number {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue)) {
    throw new BadRequestException(`${name} must be a number.`);
  }

  return parsedValue;
}

function getPunchFingerprint(request: ParsedPunchRequest): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        action: request.action,
        deviceContext: request.deviceContext,
        employeeId: request.employeeId,
        locationEvidence: request.locationEvidence,
        qrChallenge:
          request.qrChallenge === null ? null : getQrChallengeId(request.qrChallenge),
        qrChallengeTokenHash:
          request.qrChallengeToken === null
            ? null
            : hashQrChallengeToken(request.qrChallengeToken),
        source: request.source,
        workplaceId: request.workplaceId,
      }),
    )
    .digest('hex');
}

function getTurnstilePunchFingerprint(
  deviceId: string,
  request: ParsedTurnstilePunchRequest,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        deviceContext: request.deviceContext,
        deviceId,
        scanId: request.scanId,
        scannedCodeHash: hashTurnstileCode(request.scannedCode),
      }),
    )
    .digest('hex');
}

function getTurnstileIdempotencyKey(deviceId: string, scanId: string): string {
  return `turnstile:${deviceId}:${scanId}`;
}

function validateQrChallengeWindow(
  challenge: QrChallengePayload,
  rotationSeconds: number,
): void {
  const issuedAt = parseDateTime(challenge.issuedAt, 'qrChallenge.issuedAt');
  const expiresAt = parseDateTime(challenge.expiresAt, 'qrChallenge.expiresAt');
  const now = Date.now();
  const maxLifetimeMs = rotationSeconds * 1_000;
  const clockSkewMs = 5_000;

  if (issuedAt.getTime() > now + clockSkewMs) {
    throw new BadRequestException('QR challenge was issued in the future.');
  }

  if (expiresAt.getTime() <= now) {
    throw new ConflictException('QR challenge has expired.');
  }

  if (expiresAt.getTime() <= issuedAt.getTime()) {
    throw new BadRequestException('QR challenge expiration must be after issuance.');
  }

  if (expiresAt.getTime() - issuedAt.getTime() > maxLifetimeMs + clockSkewMs) {
    throw new BadRequestException('QR challenge lifetime exceeds device rotation.');
  }
}

function parseDateTime(value: string, name: string): Date {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${name} must be a date-time.`);
  }

  return parsed;
}

function getAttendanceSessionState(
  lastAction: PunchAction | undefined,
): AttendanceSessionState {
  switch (lastAction) {
    case PunchAction.CLOCK_IN:
    case PunchAction.BREAK_END:
      return {
        clockedIn: true,
        onBreak: false,
      };
    case PunchAction.BREAK_START:
      return {
        clockedIn: true,
        onBreak: true,
      };
    case PunchAction.CLOCK_OUT:
    case undefined:
      return {
        clockedIn: false,
        onBreak: false,
      };
  }
}

function isActionAllowedForState(
  action: PunchAction,
  state: AttendanceSessionState,
): boolean {
  switch (action) {
    case PunchAction.CLOCK_IN:
      return !state.clockedIn;
    case PunchAction.BREAK_START:
      return state.clockedIn && !state.onBreak;
    case PunchAction.BREAK_END:
      return state.clockedIn && state.onBreak;
    case PunchAction.CLOCK_OUT:
      return state.clockedIn && !state.onBreak;
  }
}

function getNextTurnstileAction(state: AttendanceSessionState): PunchAction {
  if (!state.clockedIn) {
    return PunchAction.CLOCK_IN;
  }

  if (!state.onBreak) {
    return PunchAction.CLOCK_OUT;
  }

  throw new ConflictException('Turnstile cannot clock out while an employee is on break.');
}

function validateDeviceTimezone(
  deviceTimezone: string | undefined,
  expectedTimezone: string,
): void {
  if (deviceTimezone === undefined) {
    return;
  }

  validateTimezone(deviceTimezone, 'deviceContext.timezone');

  if (deviceTimezone !== expectedTimezone) {
    throw new BadRequestException('deviceContext.timezone does not match policy context.');
  }
}

function validateTimezone(timezone: string, name: string): void {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
  } catch {
    throw new BadRequestException(`${name} must be a valid IANA timezone.`);
  }
}

function formatLocalDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: timezone,
    year: 'numeric',
  }).format(date);
}

function hashQrChallengeToken(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 64);
}

function hashTurnstileCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function secretsMatch(actualHash: string, expectedHash: string): boolean {
  const actual = Buffer.from(actualHash, 'hex');
  const expected = Buffer.from(expectedHash, 'hex');

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
