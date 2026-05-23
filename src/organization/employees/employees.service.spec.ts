import { createHash } from 'node:crypto';

import { ConflictException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { AttendancePolicyEntity } from '../../database/entities/attendance-policy.entity';
import { DepartmentEntity } from '../../database/entities/department.entity';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { WorkplaceEntity } from '../../database/entities/workplace.entity';
import { EmployeeStatus, UserRole } from '../../domain/enums';
import { EmployeesService } from './employees.service';

describe(EmployeesService.name, () => {
  it('looks up employees by id and tenant to prevent cross-tenant reads', async () => {
    const findOneBy = jest.fn().mockResolvedValue(null);
    const service = makeService({
      employeeRepository: {
        findOneBy,
      },
    });

    await expect(service.get('tenant-b', 'employee-a')).rejects.toThrow(
      NotFoundException,
    );
    expect(findOneBy).toHaveBeenCalledWith({
      id: 'employee-a',
      tenantId: 'tenant-b',
    });
  });

  it('always scopes employee list searches to the current tenant', async () => {
    const findAndCount = jest.fn().mockResolvedValue([
      [makeEmployee({ id: 'employee-a', tenantId: 'tenant-a' })],
      1,
    ]);
    const service = makeService({
      employeeRepository: {
        findAndCount,
      },
    });

    const response = await service.list('tenant-a', {
      search: 'ana',
      status: EmployeeStatus.INVITED,
    });

    expect(response.data).toHaveLength(1);
    expect(findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: [
          expect.objectContaining({ tenantId: 'tenant-a' }),
          expect.objectContaining({ tenantId: 'tenant-a' }),
        ],
      }),
    );
  });

  it('rejects CSV rows that reference related records from another tenant', async () => {
    const save = jest.fn();
    const service = makeService({
      departmentRepository: {
        existsBy: jest.fn().mockResolvedValue(false),
      },
      employeeRepository: {
        create: (employee: Partial<EmployeeEntity>) =>
          Object.assign(new EmployeeEntity(), employee),
        findOneBy: jest.fn().mockResolvedValue(null),
        save,
      },
    });

    const response = await service.importCsv('tenant-a', {
      csv: 'displayName,email,roles,departmentId\nAna,ana@example.com,EMPLOYEE,department-b',
      sendInvitations: true,
    });

    expect(response.imported).toBe(0);
    expect(response.skipped).toBe(1);
    expect(response.errors[0]?.message).toBe('Department not found.');
    expect(save).not.toHaveBeenCalled();
  });

  it('stores only a hash for employee turnstile codes and rejects duplicates', async () => {
    const savedEmployees: EmployeeEntity[] = [];
    const service = makeService({
      employeeRepository: {
        create: (employee: Partial<EmployeeEntity>) =>
          Object.assign(makeEmployee({}), employee),
        findOneBy: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
        save: jest.fn().mockImplementation((employee: EmployeeEntity) => {
          savedEmployees.push(employee);
          return Promise.resolve(employee);
        }),
      },
    });

    const response = await service.create('tenant-a', {
      displayName: 'Ana',
      email: 'ana@example.com',
      roles: [UserRole.EMPLOYEE],
      turnstileCode: 'EMPLOYEE-QR-001',
    });

    expect(response.turnstileCodeConfigured).toBe(true);
    expect(savedEmployees[0]?.turnstileCodeHash).toBe(hashSecret('EMPLOYEE-QR-001'));
  });

  it('rejects a turnstile code already assigned to another employee', async () => {
    const service = makeService({
      employeeRepository: {
        findOneBy: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(
            makeEmployee({
              id: 'employee-b',
              turnstileCodeHash: hashSecret('EMPLOYEE-QR-001'),
            }),
          ),
      },
    });

    await expect(
      service.create('tenant-a', {
        displayName: 'Ana',
        email: 'ana@example.com',
        roles: [UserRole.EMPLOYEE],
        turnstileCode: 'EMPLOYEE-QR-001',
      }),
    ).rejects.toThrow(ConflictException);
  });
});

function makeService(overrides: {
  employeeRepository?: Partial<Repository<EmployeeEntity>>;
  workplaceRepository?: Partial<Repository<WorkplaceEntity>>;
  departmentRepository?: Partial<Repository<DepartmentEntity>>;
  attendancePolicyRepository?: Partial<Repository<AttendancePolicyEntity>>;
}): EmployeesService {
  const relationRepository = {
    existsBy: jest.fn().mockResolvedValue(true),
  };

  return new EmployeesService(
    makeRepository(overrides.employeeRepository),
    makeRepository(overrides.workplaceRepository ?? relationRepository),
    makeRepository(overrides.departmentRepository ?? relationRepository),
    makeRepository(overrides.attendancePolicyRepository ?? relationRepository),
  );
}

function makeRepository<T>(overrides: Partial<Repository<T>> = {}): Repository<T> {
  return {
    create: (entity: Partial<T>) => entity,
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    findOneBy: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockImplementation((entity: T) => Promise.resolve(entity)),
    ...overrides,
  } as unknown as Repository<T>;
}

function makeEmployee(overrides: Partial<EmployeeEntity>): EmployeeEntity {
  return Object.assign(new EmployeeEntity(), {
    attendancePolicyId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    departmentId: null,
    displayName: 'Ana',
    email: 'ana@example.com',
    id: 'employee-a',
    roles: [UserRole.EMPLOYEE],
    status: EmployeeStatus.INVITED,
    tenantId: 'tenant-a',
    turnstileCodeHash: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    userId: null,
    workplaceId: null,
    ...overrides,
  });
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}
