import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';

import { EmployeeStatus, UserRole } from '../../domain/enums';
import { AttendanceAdjustmentEntity } from './attendance-adjustment.entity';
import { AttendanceEventEntity } from './attendance-event.entity';
import { AttendancePolicyEntity } from './attendance-policy.entity';
import { AuditLogEntity } from './audit-log.entity';
import { DepartmentEntity } from './department.entity';
import { TenantEntity } from './tenant.entity';
import { UserEntity } from './user.entity';
import { WorkplaceEntity } from './workplace.entity';

@Entity({ name: 'employees' })
@Index('idx_employees_tenant_id', ['tenantId'])
@Index('uq_employees_tenant_email', ['tenantId', 'email'], { unique: true })
@Index('uq_employees_tenant_turnstile_code_hash', ['tenantId', 'turnstileCodeHash'], {
  unique: true,
})
export class EmployeeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ name: 'workplace_id', type: 'uuid', nullable: true })
  workplaceId!: string | null;

  @Column({ name: 'department_id', type: 'uuid', nullable: true })
  departmentId!: string | null;

  @Column({ name: 'attendance_policy_id', type: 'uuid', nullable: true })
  attendancePolicyId!: string | null;

  @Column({ name: 'display_name', type: 'varchar', length: 160 })
  displayName!: string;

  @Column({ type: 'varchar', length: 320 })
  email!: string;

  @Column({ name: 'turnstile_code_hash', type: 'varchar', length: 128, nullable: true })
  turnstileCodeHash!: string | null;

  @Column({
    default: EmployeeStatus.INVITED,
    enum: EmployeeStatus,
    enumName: 'employee_status',
    type: 'enum',
  })
  status!: EmployeeStatus;

  @Column({
    array: true,
    default: () => "ARRAY['EMPLOYEE']::user_role[]",
    enum: UserRole,
    enumName: 'user_role',
    type: 'enum',
  })
  roles!: UserRole[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => TenantEntity, (tenant) => tenant.employees, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Relation<TenantEntity>;

  @ManyToOne(() => UserEntity, (user) => user.employees, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user!: Relation<UserEntity> | null;

  @ManyToOne(() => WorkplaceEntity, (workplace) => workplace.employees, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'workplace_id' })
  workplace!: Relation<WorkplaceEntity> | null;

  @ManyToOne(() => DepartmentEntity, (department) => department.employees, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'department_id' })
  department!: Relation<DepartmentEntity> | null;

  @ManyToOne(() => AttendancePolicyEntity, (policy) => policy.employees, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'attendance_policy_id' })
  attendancePolicy!: Relation<AttendancePolicyEntity> | null;

  @OneToMany(() => AttendanceEventEntity, (event) => event.employee)
  attendanceEvents!: AttendanceEventEntity[];

  @OneToMany(() => AttendanceAdjustmentEntity, (adjustment) => adjustment.employee)
  adjustments!: AttendanceAdjustmentEntity[];

  @OneToMany(() => AuditLogEntity, (auditLog) => auditLog.actorEmployee)
  auditLogs!: AuditLogEntity[];
}
