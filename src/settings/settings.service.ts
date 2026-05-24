import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantEntity } from '../database/entities/tenant.entity';
import {
  SecuritySettingsDto,
  SecuritySettingsUpdateRequestDto,
} from './dto/security-settings.dto';

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(TenantEntity)
    private readonly tenantRepository: Repository<TenantEntity>,
  ) {}

  async getSecuritySettings(tenantId: string): Promise<SecuritySettingsDto> {
    return toSecuritySettingsDto(await this.getTenantOrFail(tenantId));
  }

  async updateSecuritySettings(
    tenantId: string,
    request: SecuritySettingsUpdateRequestDto,
  ): Promise<SecuritySettingsDto> {
    const tenant = await this.getTenantOrFail(tenantId);

    tenant.sessionDeviceLimit = parseSessionDeviceLimit(request.sessionDeviceLimit);

    return toSecuritySettingsDto(await this.tenantRepository.save(tenant));
  }

  private async getTenantOrFail(tenantId: string): Promise<TenantEntity> {
    const tenant = await this.tenantRepository.findOneBy({ id: tenantId });

    if (tenant === null) {
      throw new NotFoundException('Tenant not found.');
    }

    return tenant;
  }
}

function parseSessionDeviceLimit(value: unknown): number | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new BadRequestException('sessionDeviceLimit must be an integer or null.');
  }

  if (value < 1 || value > 10) {
    throw new BadRequestException('sessionDeviceLimit must be between 1 and 10.');
  }

  return value;
}

function toSecuritySettingsDto(tenant: TenantEntity): SecuritySettingsDto {
  return {
    sessionDeviceLimit: tenant.sessionDeviceLimit,
    tenantId: tenant.id,
  };
}
