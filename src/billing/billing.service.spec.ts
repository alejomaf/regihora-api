import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';

import { EnvironmentVariables } from '../config/environment.validation';
import { TenantEntity } from '../database/entities/tenant.entity';
import { BillingStatus, TenantPlan } from '../domain/enums';
import { BillingService } from './billing.service';

describe(BillingService.name, () => {
  it('returns tenant billing state without exposing Stripe identifiers', async () => {
    const tenant = makeTenant({
      billingCurrentPeriodEnd: new Date('2026-02-01T00:00:00.000Z'),
      billingStatus: BillingStatus.ACTIVE,
      plan: TenantPlan.PRO,
      stripeCustomerId: 'cus_test',
      trialEndsAt: null,
    });
    const service = makeService(tenant);

    await expect(service.getSubscription(tenant.id)).resolves.toEqual({
      canOpenCustomerPortal: true,
      currentPeriodEnd: '2026-02-01T00:00:00.000Z',
      plan: TenantPlan.PRO,
      status: BillingStatus.ACTIVE,
      tenantId: tenant.id,
      trialEndsAt: null,
    });
  });

  it('does not create checkout sessions when Stripe is not configured', async () => {
    const tenant = makeTenant();
    const service = makeService(tenant);

    await expect(
      service.createCheckoutSession(
        tenant.id,
        { email: 'owner@example.com', sub: 'user-1' },
        {
          cancelUrl: 'http://localhost:4204/facturacion?checkout=cancel',
          plan: TenantPlan.PRO,
          successUrl: 'http://localhost:4204/facturacion?checkout=success',
        },
      ),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});

function makeService(tenant: TenantEntity): BillingService {
  const tenantRepository = {
    findOneBy: (where: Partial<TenantEntity>) =>
      Promise.resolve(where.id === tenant.id ? tenant : null),
    save: (updatedTenant: TenantEntity) => Promise.resolve(updatedTenant),
  } as unknown as Repository<TenantEntity>;
  const configService = {
    get: () => null,
  } as unknown as ConfigService<EnvironmentVariables, true>;

  return new BillingService(tenantRepository, configService);
}

function makeTenant(overrides: Partial<TenantEntity> = {}): TenantEntity {
  return Object.assign(new TenantEntity(), {
    billingCurrentPeriodEnd: null,
    billingStatus: BillingStatus.FREE,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    id: 'tenant-1',
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
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}
