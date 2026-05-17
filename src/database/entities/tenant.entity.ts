import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { TenantPlan } from '../../domain/enums';
import { AttendanceAdjustmentEntity } from './attendance-adjustment.entity';
import { AttendanceEventEntity } from './attendance-event.entity';
import { AttendancePolicyEntity } from './attendance-policy.entity';
import { AuditLogEntity } from './audit-log.entity';
import { DepartmentEntity } from './department.entity';
import { DeviceEntity } from './device.entity';
import { EmployeeEntity } from './employee.entity';
import { WorkplaceEntity } from './workplace.entity';

@Entity({ name: 'tenants' })
@Index('uq_tenants_tax_id', ['taxId'], { unique: true })
export class TenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'legal_name', type: 'varchar', length: 200 })
  legalName!: string;

  @Column({ name: 'tax_id', type: 'varchar', length: 32 })
  taxId!: string;

  @Column({
    default: TenantPlan.FREE,
    enum: TenantPlan,
    enumName: 'tenant_plan',
    type: 'enum',
  })
  plan!: TenantPlan;

  @Column({ default: 'Europe/Madrid', type: 'varchar', length: 64 })
  timezone!: string;

  @Column({ default: 'es-ES', type: 'varchar', length: 16 })
  locale!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => EmployeeEntity, (employee) => employee.tenant)
  employees!: EmployeeEntity[];

  @OneToMany(() => DepartmentEntity, (department) => department.tenant)
  departments!: DepartmentEntity[];

  @OneToMany(() => WorkplaceEntity, (workplace) => workplace.tenant)
  workplaces!: WorkplaceEntity[];

  @OneToMany(() => AttendancePolicyEntity, (policy) => policy.tenant)
  attendancePolicies!: AttendancePolicyEntity[];

  @OneToMany(() => DeviceEntity, (device) => device.tenant)
  devices!: DeviceEntity[];

  @OneToMany(() => AttendanceEventEntity, (event) => event.tenant)
  attendanceEvents!: AttendanceEventEntity[];

  @OneToMany(() => AttendanceAdjustmentEntity, (adjustment) => adjustment.tenant)
  adjustments!: AttendanceAdjustmentEntity[];

  @OneToMany(() => AuditLogEntity, (auditLog) => auditLog.tenant)
  auditLogs!: AuditLogEntity[];
}
