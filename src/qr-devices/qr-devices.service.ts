import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';

import { DeviceEntity } from '../database/entities/device.entity';
import { WorkplaceEntity } from '../database/entities/workplace.entity';
import { DeviceStatus, DeviceType, ResourceStatus } from '../domain/enums';
import {
  parseEnumValue,
  parseOptionalEnumValue,
  parseOptionalString,
  parseRequiredString,
} from '../organization/common/request-parsing';
import {
  QrChallengeDto,
  QrDeviceCreateRequestDto,
  QrDeviceDto,
  QrDeviceEnrollmentDto,
  QrDeviceEnrollmentTokenDto,
  QrDeviceEnrollRequestDto,
  QrDeviceHeartbeatDto,
  QrDeviceListQueryDto,
  QrDeviceListResponseDto,
  QrDeviceUpdateRequestDto,
} from './dto/qr-device.dto';
import {
  createQrChallengeNonce,
  createQrDevicePublicId,
  signQrChallenge,
} from './qr-challenge';
import { toQrDeviceDto } from './qr-devices.mapper';

const enrollmentTokenTtlMs = 15 * 60 * 1000;

@Injectable()
export class QrDevicesService {
  constructor(
    @InjectRepository(DeviceEntity)
    private readonly deviceRepository: Repository<DeviceEntity>,
    @InjectRepository(WorkplaceEntity)
    private readonly workplaceRepository: Repository<WorkplaceEntity>,
  ) {}

  async list(
    tenantId: string,
    query: QrDeviceListQueryDto,
  ): Promise<QrDeviceListResponseDto> {
    const workplaceId = parseOptionalString(query.workplaceId, 'workplaceId', 80);
    const status = parseOptionalEnumValue(
      query.status,
      DeviceStatus,
      'status',
    );
    const type = parseOptionalEnumValue(query.type, DeviceType, 'type');
    const where: FindOptionsWhere<DeviceEntity> = {
      tenantId,
      ...(status === undefined ? {} : { status }),
      ...(type === undefined ? {} : { type }),
      ...(workplaceId === undefined ? {} : { workplaceId }),
    };
    const devices = await this.deviceRepository.find({
      order: {
        createdAt: 'DESC',
        id: 'ASC',
      },
      where,
    });

    return {
      data: devices.map(toQrDeviceDto),
    };
  }

  async create(
    tenantId: string,
    request: QrDeviceCreateRequestDto,
  ): Promise<QrDeviceDto> {
    const workplaceId = parseRequiredString(request.workplaceId, 'workplaceId', 80);
    const type =
      request.type === undefined
        ? DeviceType.FIXED_DYNAMIC_QR
        : parseEnumValue(request.type, DeviceType, 'type');
    const name = parseRequiredString(request.name, 'name', 160);
    const rotationSeconds = parseRotationSeconds(request.rotationSeconds, 60);

    await this.ensureWorkplaceIsActive(tenantId, workplaceId);
    await this.ensureNameAvailable(tenantId, workplaceId, name);

    const device = this.deviceRepository.create({
      name,
      publicId: createQrDevicePublicId(),
      rotationSeconds,
      status: DeviceStatus.INACTIVE,
      tenantId,
      type,
      workplaceId,
    });

    return toQrDeviceDto(await this.deviceRepository.save(device));
  }

  async get(tenantId: string, qrDeviceId: string): Promise<QrDeviceDto> {
    return toQrDeviceDto(await this.getEntityOrFail(tenantId, qrDeviceId));
  }

  async update(
    tenantId: string,
    qrDeviceId: string,
    request: QrDeviceUpdateRequestDto,
  ): Promise<QrDeviceDto> {
    const device = await this.getEntityOrFail(tenantId, qrDeviceId);
    const name = parseOptionalString(request.name, 'name', 160);
    const rotationSeconds =
      request.rotationSeconds === undefined
        ? undefined
        : parseRotationSeconds(request.rotationSeconds, device.rotationSeconds);
    const status = parseOptionalEnumValue(
      request.status,
      DeviceStatus,
      'status',
    );

    if (name !== undefined && name !== device.name) {
      await this.ensureNameAvailable(tenantId, device.workplaceId, name, device.id);
      device.name = name;
    }

    if (rotationSeconds !== undefined) {
      device.rotationSeconds = rotationSeconds;
    }

    if (status !== undefined) {
      this.applyStatusUpdate(device, status);
    }

    return toQrDeviceDto(await this.deviceRepository.save(device));
  }

  async createEnrollmentToken(
    tenantId: string,
    qrDeviceId: string,
  ): Promise<QrDeviceEnrollmentTokenDto> {
    const device = await this.getEntityOrFail(tenantId, qrDeviceId);

    if (device.status === DeviceStatus.REVOKED) {
      throw new ConflictException('Revoked QR devices cannot be enrolled.');
    }

    if (device.status === DeviceStatus.ACTIVE) {
      throw new ConflictException('QR device is already enrolled.');
    }

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + enrollmentTokenTtlMs);
    const enrollmentToken = createDeviceSecret(32);

    device.enrollmentTokenHash = hashSecret(enrollmentToken);
    device.enrollmentTokenExpiresAt = expiresAt;
    await this.deviceRepository.save(device);

    return {
      enrollmentToken,
      expiresAt: expiresAt.toISOString(),
      issuedAt: issuedAt.toISOString(),
      qrDeviceId: device.id,
    };
  }

  async enroll(
    request: QrDeviceEnrollRequestDto,
  ): Promise<QrDeviceEnrollmentDto> {
    const enrollmentToken = parseToken(
      request.enrollmentToken,
      'enrollmentToken',
    );
    const device = await this.deviceRepository.findOneBy({
      enrollmentTokenHash: hashSecret(enrollmentToken),
    });
    const enrollmentTokenExpiresAt = device?.enrollmentTokenExpiresAt ?? null;
    const now = new Date();

    if (device === null || enrollmentTokenExpiresAt === null) {
      throw new UnauthorizedException('Invalid enrollment token.');
    }

    if (enrollmentTokenExpiresAt.getTime() <= now.getTime()) {
      throw new UnauthorizedException('Enrollment token has expired.');
    }

    if (device.status === DeviceStatus.REVOKED) {
      throw new ConflictException('QR device is revoked.');
    }

    if (device.status === DeviceStatus.ACTIVE) {
      throw new ConflictException('QR device is already enrolled.');
    }

    const deviceToken = createDeviceSecret(48);

    device.deviceTokenHash = hashSecret(deviceToken);
    device.enrolledAt = now;
    device.enrollmentTokenExpiresAt = null;
    device.enrollmentTokenHash = null;
    device.lastHeartbeatAt = now;
    device.revokedAt = null;
    device.status = DeviceStatus.ACTIVE;

    const savedDevice = await this.deviceRepository.save(device);

    return {
      device: toQrDeviceDto(savedDevice),
      deviceToken,
      heartbeatIntervalSeconds: getHeartbeatIntervalSeconds(savedDevice),
    };
  }

  async revoke(tenantId: string, qrDeviceId: string): Promise<QrDeviceDto> {
    const device = await this.getEntityOrFail(tenantId, qrDeviceId);

    this.revokeEntity(device);

    return toQrDeviceDto(await this.deviceRepository.save(device));
  }

  async heartbeat(
    qrDeviceId: string,
    deviceToken: unknown,
  ): Promise<QrDeviceHeartbeatDto> {
    const parsedDeviceToken = parseToken(deviceToken, 'X-Regihora-Device-Token');
    const device = await this.deviceRepository.findOneBy({ id: qrDeviceId });

    if (device === null) {
      throw new NotFoundException('QR device not found.');
    }

    if (
      device.deviceTokenHash === null ||
      !secretsMatch(hashSecret(parsedDeviceToken), device.deviceTokenHash)
    ) {
      throw new UnauthorizedException('Invalid device token.');
    }

    if (device.status !== DeviceStatus.ACTIVE) {
      throw new ConflictException('QR device is not active.');
    }

    const now = new Date();

    device.lastHeartbeatAt = now;
    const savedDevice = await this.deviceRepository.save(device);

    return {
      lastHeartbeatAt: now.toISOString(),
      nextHeartbeatAfterSeconds: getHeartbeatIntervalSeconds(savedDevice),
      qrDeviceId: savedDevice.id,
      serverTime: now.toISOString(),
      status: savedDevice.status,
      tenantId: savedDevice.tenantId,
    };
  }

  async createChallenge(
    qrDeviceId: string,
    deviceToken: unknown,
  ): Promise<QrChallengeDto> {
    const device = await this.getActiveDeviceByToken(qrDeviceId, deviceToken);

    if (device.type !== DeviceType.FIXED_DYNAMIC_QR) {
      throw new ConflictException('Only fixed dynamic QR devices can create challenges.');
    }

    const issuedAt = new Date();
    const expiresAt = new Date(
      issuedAt.getTime() + getHeartbeatIntervalSeconds(device) * 1_000,
    );
    const unsignedChallenge = {
      devicePublicId: device.publicId,
      expiresAt: expiresAt.toISOString(),
      issuedAt: issuedAt.toISOString(),
      nonce: createQrChallengeNonce(),
    };

    return {
      ...unsignedChallenge,
      signature: signQrChallenge(unsignedChallenge, device.deviceTokenHash),
    };
  }

  private async getEntityOrFail(
    tenantId: string,
    qrDeviceId: string,
  ): Promise<DeviceEntity> {
    const device = await this.deviceRepository.findOneBy({
      id: qrDeviceId,
      tenantId,
    });

    if (device === null) {
      throw new NotFoundException('QR device not found.');
    }

    return device;
  }

  private async getActiveDeviceByToken(
    qrDeviceId: string,
    deviceToken: unknown,
  ): Promise<DeviceEntity & { deviceTokenHash: string }> {
    const parsedDeviceToken = parseToken(deviceToken, 'X-Regihora-Device-Token');
    const device = await this.deviceRepository.findOneBy({ id: qrDeviceId });

    if (device === null) {
      throw new NotFoundException('QR device not found.');
    }

    if (
      device.deviceTokenHash === null ||
      !secretsMatch(hashSecret(parsedDeviceToken), device.deviceTokenHash)
    ) {
      throw new UnauthorizedException('Invalid device token.');
    }

    if (device.status !== DeviceStatus.ACTIVE) {
      throw new ConflictException('QR device is not active.');
    }

    return device as DeviceEntity & { deviceTokenHash: string };
  }

  private async ensureWorkplaceIsActive(
    tenantId: string,
    workplaceId: string,
  ): Promise<void> {
    const workplace = await this.workplaceRepository.findOneBy({
      id: workplaceId,
      tenantId,
    });

    if (workplace === null) {
      throw new NotFoundException('Workplace not found.');
    }

    if (workplace.status !== ResourceStatus.ACTIVE) {
      throw new ConflictException('Workplace is not active.');
    }
  }

  private async ensureNameAvailable(
    tenantId: string,
    workplaceId: string,
    name: string,
    exceptQrDeviceId?: string,
  ): Promise<void> {
    const existingDevice = await this.deviceRepository.findOneBy({
      name,
      tenantId,
      workplaceId,
    });

    if (existingDevice !== null && existingDevice.id !== exceptQrDeviceId) {
      throw new ConflictException('QR device name already exists in workplace.');
    }
  }

  private applyStatusUpdate(device: DeviceEntity, status: DeviceStatus): void {
    if (status === DeviceStatus.REVOKED) {
      this.revokeEntity(device);
      return;
    }

    if (status === DeviceStatus.ACTIVE && device.deviceTokenHash === null) {
      throw new ConflictException('QR device must be enrolled before activation.');
    }

    device.status = status;
  }

  private revokeEntity(device: DeviceEntity): void {
    const now = new Date();

    device.deviceTokenHash = null;
    device.enrollmentTokenExpiresAt = null;
    device.enrollmentTokenHash = null;
    device.revokedAt = device.revokedAt ?? now;
    device.status = DeviceStatus.REVOKED;
  }
}

function parseRotationSeconds(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const rotationSeconds = Number(value);

  if (
    !Number.isInteger(rotationSeconds) ||
    rotationSeconds < 15 ||
    rotationSeconds > 300
  ) {
    throw new BadRequestException('rotationSeconds must be between 15 and 300.');
  }

  return rotationSeconds;
}

function parseToken(value: unknown, name: string): string {
  const token = parseRequiredString(value, name, 256);

  if (token.length < 32) {
    throw new BadRequestException(`${name} must be at least 32 characters.`);
  }

  return token;
}

function createDeviceSecret(byteLength: number): string {
  return randomBytes(byteLength).toString('base64url');
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function secretsMatch(actualHash: string, expectedHash: string): boolean {
  const actual = Buffer.from(actualHash, 'hex');
  const expected = Buffer.from(expectedHash, 'hex');

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function getHeartbeatIntervalSeconds(device: DeviceEntity): number {
  return Math.min(300, Math.max(15, device.rotationSeconds));
}
