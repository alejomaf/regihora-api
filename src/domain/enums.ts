export enum UserRole {
  EMPLOYEE = 'EMPLOYEE',
  MANAGER = 'MANAGER',
  HR_ADMIN = 'HR_ADMIN',
  OWNER = 'OWNER',
  AUDITOR = 'AUDITOR',
}

export enum EmployeeStatus {
  INVITED = 'INVITED',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum AttendanceEventType {
  PUNCH = 'PUNCH',
  ADJUSTMENT = 'ADJUSTMENT',
}

export enum AttendanceSource {
  REMOTE = 'REMOTE',
  IN_PERSON = 'IN_PERSON',
  FIXED_DYNAMIC_QR = 'FIXED_DYNAMIC_QR',
  MANUAL_ADJUSTMENT = 'MANUAL_ADJUSTMENT',
}

export enum AttendancePolicyMode {
  REMOTE = 'REMOTE',
  ONSITE_QR = 'ONSITE_QR',
  HYBRID = 'HYBRID',
}

export enum PunchAction {
  CLOCK_IN = 'CLOCK_IN',
  CLOCK_OUT = 'CLOCK_OUT',
  BREAK_START = 'BREAK_START',
  BREAK_END = 'BREAK_END',
}

export enum DeviceType {
  FIXED_DYNAMIC_QR = 'FIXED_DYNAMIC_QR',
  TURNSTILE = 'TURNSTILE',
}

export enum DeviceStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  REVOKED = 'REVOKED',
}

export enum WorkMode {
  IN_PERSON = 'IN_PERSON',
  REMOTE = 'REMOTE',
  HYBRID = 'HYBRID',
  FIELD = 'FIELD',
}

export enum AdjustmentStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum SupportTicketStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

export enum SupportTicketPriority {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export enum ReportFormat {
  CSV = 'CSV',
  XLSX = 'XLSX',
  PDF = 'PDF',
}

export enum TenantPlan {
  FREE = 'FREE',
  ESSENTIAL = 'ESSENTIAL',
  PRO = 'PRO',
  BUSINESS = 'BUSINESS',
  ENTERPRISE = 'ENTERPRISE',
}

export enum BillingStatus {
  FREE = 'FREE',
  CHECKOUT_REQUIRED = 'CHECKOUT_REQUIRED',
  TRIALING = 'TRIALING',
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  CANCELED = 'CANCELED',
  INCOMPLETE = 'INCOMPLETE',
  UNPAID = 'UNPAID',
}

export enum ResourceStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}
