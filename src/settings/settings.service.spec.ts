import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { TenantPlan } from '../domain/enums';
import { TenantEntity } from '../database/entities/tenant.entity';
import { SettingsService } from './settings.service';

describe(SettingsService.name, () => {
  it('returns the current company security settings', async () => {
    const tenant = makeTenant({ sessionDeviceLimit: 3 });
    const service = makeService(tenant);

    await expect(service.getSecuritySettings('tenant-a')).resolves.toEqual({
      sessionDeviceLimit: 3,
      tenantId: 'tenant-a',
    });
  });

  it('updates the device limit and allows unlimited sessions with null', async () => {
    const tenant = makeTenant({ sessionDeviceLimit: 2 });
    const save = jest.fn((value: TenantEntity) => Promise.resolve(value));
    const service = makeService(tenant, save);

    await expect(
      service.updateSecuritySettings('tenant-a', { sessionDeviceLimit: null }),
    ).resolves.toEqual({
      sessionDeviceLimit: null,
      tenantId: 'tenant-a',
    });

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ sessionDeviceLimit: null }));
  });

  it('rejects invalid device limits', async () => {
    const service = makeService(makeTenant());

    await expect(
      service.updateSecuritySettings('tenant-a', { sessionDeviceLimit: 0 }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.updateSecuritySettings('tenant-a', { sessionDeviceLimit: 11 }),
    ).rejects.toThrow(BadRequestException);
  });
});

function makeService(
  tenant: TenantEntity | null,
  save = jest.fn((value: TenantEntity) => Promise.resolve(value)),
): SettingsService {
  const tenantRepository = {
    findOneBy: () => Promise.resolve(tenant),
    save,
  } as unknown as Repository<TenantEntity>;

  return new SettingsService(tenantRepository);
}

function makeTenant(overrides: Partial<TenantEntity> = {}): TenantEntity {
  return Object.assign(new TenantEntity(), {
    id: 'tenant-a',
    legalName: 'Empresa actual',
    locale: 'es-ES',
    plan: TenantPlan.FREE,
    sessionDeviceLimit: null,
    taxId: 'B00000000',
    timezone: 'Europe/Madrid',
    ...overrides,
  });
}
