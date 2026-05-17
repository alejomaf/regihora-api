import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FindManyOptions, Repository } from 'typeorm';

import { AttendancePolicyEntity } from '../database/entities/attendance-policy.entity';
import { WorkplaceEntity } from '../database/entities/workplace.entity';
import { AttendancePolicyMode, ResourceStatus } from '../domain/enums';
import { AttendancePoliciesService } from './attendance-policies.service';

describe(AttendancePoliciesService.name, () => {
  it('creates hybrid policies with optional geolocation, IP allowlist, centers, and auto-checkout', async () => {
    const savedPolicies: AttendancePolicyEntity[] = [];
    const service = makeService({
      policyRepository: {
        create: (policy: Partial<AttendancePolicyEntity>) =>
          Object.assign(makePolicy(), policy),
        findOneBy: jest.fn().mockResolvedValue(null),
        save: jest.fn().mockImplementation((policy: AttendancePolicyEntity) => {
          savedPolicies.push(policy);
          return Promise.resolve(policy);
        }),
      },
      workplaceRepository: {
        findBy: jest
          .fn()
          .mockResolvedValue([{ id: 'workplace-a', tenantId: 'tenant-a' }]),
      },
    });

    const response = await service.create('tenant-a', {
      allowedWorkplaceIds: ['workplace-a'],
      autoCheckout: {
        afterMinutes: 720,
        enabled: true,
      },
      geolocationRequired: true,
      ipAllowlist: ['203.0.113.10', '2001:db8::/32'],
      mode: AttendancePolicyMode.HYBRID,
      name: 'Hibrida',
    });

    expect(response).toEqual(
      expect.objectContaining({
        allowedWorkplaceIds: ['workplace-a'],
        autoCheckout: {
          afterMinutes: 720,
          enabled: true,
        },
        geolocationRequired: true,
        ipAllowlist: ['203.0.113.10', '2001:db8::/32'],
        mode: AttendancePolicyMode.HYBRID,
        status: ResourceStatus.ACTIVE,
      }),
    );
    expect(savedPolicies).toHaveLength(1);
  });

  it('rejects allowed workplaces that do not belong to the tenant', async () => {
    const service = makeService({
      policyRepository: {
        findOneBy: jest.fn().mockResolvedValue(null),
      },
      workplaceRepository: {
        findBy: jest.fn().mockResolvedValue([]),
      },
    });

    await expect(
      service.create('tenant-a', {
        allowedWorkplaceIds: ['workplace-b'],
        mode: AttendancePolicyMode.ONSITE_QR,
        name: 'QR centro',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects invalid IP allowlist values', async () => {
    const service = makeService();

    await expect(
      service.create('tenant-a', {
        ipAllowlist: ['office-network'],
        mode: AttendancePolicyMode.REMOTE,
        name: 'Remota',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('requires afterMinutes when auto-checkout is enabled', async () => {
    const service = makeService();

    await expect(
      service.create('tenant-a', {
        autoCheckout: {
          enabled: true,
        },
        mode: AttendancePolicyMode.REMOTE,
        name: 'Remota',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('scopes list queries to the current tenant', async () => {
    const findAndCount = jest
      .fn<
        Promise<[AttendancePolicyEntity[], number]>,
        [FindManyOptions<AttendancePolicyEntity>?]
      >()
      .mockResolvedValue([[makePolicy({ id: 'policy-a', tenantId: 'tenant-a' })], 1]);
    const service = makeService({
      policyRepository: {
        findAndCount,
      },
    });

    const response = await service.list('tenant-a', {
      mode: AttendancePolicyMode.HYBRID,
      search: 'hibrida',
    });

    expect(response.data).toHaveLength(1);
    expect(findAndCount.mock.calls[0]?.[0]?.where).toEqual(
      expect.objectContaining({
        mode: AttendancePolicyMode.HYBRID,
        tenantId: 'tenant-a',
      }),
    );
  });
});

function makeService(overrides: {
  policyRepository?: Partial<Repository<AttendancePolicyEntity>>;
  workplaceRepository?: Partial<Repository<WorkplaceEntity>>;
} = {}): AttendancePoliciesService {
  return new AttendancePoliciesService(
    makeRepository(overrides.policyRepository),
    makeRepository(overrides.workplaceRepository),
  );
}

function makeRepository<T>(overrides: Partial<Repository<T>> = {}): Repository<T> {
  return {
    create: (entity: Partial<T>) => entity,
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    findBy: jest.fn().mockResolvedValue([]),
    findOneBy: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockImplementation((entity: T) => Promise.resolve(entity)),
    ...overrides,
  } as unknown as Repository<T>;
}

function makePolicy(overrides: Partial<AttendancePolicyEntity> = {}): AttendancePolicyEntity {
  return Object.assign(new AttendancePolicyEntity(), {
    allowedWorkplaceIds: [],
    autoCheckoutAfterMinutes: null,
    autoCheckoutEnabled: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    geolocationRequired: false,
    id: 'policy-a',
    ipAllowlist: [],
    mode: AttendancePolicyMode.REMOTE,
    name: 'Remota',
    status: ResourceStatus.ACTIVE,
    tenantId: 'tenant-a',
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}
