import { EmployeeStatus, ResourceStatus, UserRole, WorkMode } from '../../domain/enums';

export type ListQueryDto = {
  limit?: string;
  cursor?: string;
  search?: string;
  status?: string;
  workplaceId?: string;
  departmentId?: string;
};

export type PaginationDto = {
  nextCursor: string | null;
};

export type PaginatedResponseDto<T> = {
  data: T[];
  pagination: PaginationDto;
};

export type DepartmentDto = {
  id: string;
  tenantId: string;
  name: string;
  status: ResourceStatus;
  createdAt: string;
  updatedAt: string;
};

export type DepartmentCreateRequestDto = {
  name?: unknown;
};

export type DepartmentUpdateRequestDto = {
  name?: unknown;
  status?: unknown;
};

export type WorkplaceDto = {
  id: string;
  tenantId: string;
  name: string;
  type: WorkMode;
  timezone: string;
  status: ResourceStatus;
  createdAt: string;
  updatedAt: string;
};

export type WorkplaceCreateRequestDto = {
  name?: unknown;
  type?: unknown;
  timezone?: unknown;
};

export type WorkplaceUpdateRequestDto = {
  name?: unknown;
  type?: unknown;
  timezone?: unknown;
  status?: unknown;
};

export type EmployeeDto = {
  id: string;
  tenantId: string;
  userId: string | null;
  displayName: string;
  email: string;
  status: EmployeeStatus;
  roles: UserRole[];
  workplaceId: string | null;
  departmentId: string | null;
  attendancePolicyId: string | null;
  turnstileCodeConfigured: boolean;
  createdAt: string;
  updatedAt: string;
};

export type EmployeeCreateRequestDto = {
  displayName?: unknown;
  email?: unknown;
  roles?: unknown;
  workplaceId?: unknown;
  departmentId?: unknown;
  attendancePolicyId?: unknown;
  turnstileCode?: unknown;
};

export type EmployeeUpdateRequestDto = {
  displayName?: unknown;
  status?: unknown;
  roles?: unknown;
  workplaceId?: unknown;
  departmentId?: unknown;
  attendancePolicyId?: unknown;
  turnstileCode?: unknown;
};

export type EmployeeInvitationDto = {
  employee: EmployeeDto;
  invited: boolean;
};

export type EmployeeCsvImportRequestDto = {
  csv?: unknown;
  sendInvitations?: unknown;
};

export type EmployeeCsvImportErrorDto = {
  row: number;
  message: string;
};

export type EmployeeCsvImportResponseDto = {
  imported: number;
  invited: number;
  skipped: number;
  errors: EmployeeCsvImportErrorDto[];
  employees: EmployeeDto[];
};
