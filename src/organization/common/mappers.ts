import { DepartmentEntity } from '../../database/entities/department.entity';
import { EmployeeEntity } from '../../database/entities/employee.entity';
import { WorkplaceEntity } from '../../database/entities/workplace.entity';
import {
  DepartmentDto,
  EmployeeDto,
  WorkplaceDto,
} from '../dto/organization.dto';

export function toDepartmentDto(department: DepartmentEntity): DepartmentDto {
  return {
    createdAt: department.createdAt.toISOString(),
    id: department.id,
    name: department.name,
    status: department.status,
    tenantId: department.tenantId,
    updatedAt: department.updatedAt.toISOString(),
  };
}

export function toWorkplaceDto(workplace: WorkplaceEntity): WorkplaceDto {
  return {
    createdAt: workplace.createdAt.toISOString(),
    id: workplace.id,
    name: workplace.name,
    status: workplace.status,
    tenantId: workplace.tenantId,
    timezone: workplace.timezone,
    type: workplace.mode,
    updatedAt: workplace.updatedAt.toISOString(),
  };
}

export function toEmployeeDto(employee: EmployeeEntity): EmployeeDto {
  return {
    attendancePolicyId: employee.attendancePolicyId,
    createdAt: employee.createdAt.toISOString(),
    departmentId: employee.departmentId,
    displayName: employee.displayName,
    email: employee.email,
    id: employee.id,
    roles: employee.roles,
    status: employee.status,
    tenantId: employee.tenantId,
    turnstileCodeConfigured: employee.turnstileCodeHash !== null,
    updatedAt: employee.updatedAt.toISOString(),
    userId: employee.userId,
    workplaceId: employee.workplaceId,
  };
}
