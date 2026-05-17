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

import {
  AttendancePolicyMode,
  ResourceStatus,
} from '../../domain/enums';
import { EmployeeEntity } from './employee.entity';
import { TenantEntity } from './tenant.entity';

@Entity({ name: 'policies' })
@Index('idx_policies_tenant_id', ['tenantId'])
@Index('uq_policies_tenant_name', ['tenantId', 'name'], { unique: true })
export class AttendancePolicyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({
    enum: AttendancePolicyMode,
    enumName: 'attendance_policy_mode',
    name: 'mode',
    type: 'enum',
  })
  mode!: AttendancePolicyMode;

  @Column({ name: 'geolocation_required', type: 'boolean', default: false })
  geolocationRequired!: boolean;

  @Column({ array: true, name: 'ip_allowlist', type: 'text', default: () => "'{}'" })
  ipAllowlist!: string[];

  @Column({
    array: true,
    name: 'allowed_workplace_ids',
    type: 'uuid',
    default: () => "'{}'",
  })
  allowedWorkplaceIds!: string[];

  @Column({ name: 'auto_checkout_enabled', type: 'boolean', default: false })
  autoCheckoutEnabled!: boolean;

  @Column({ name: 'auto_checkout_after_minutes', type: 'integer', nullable: true })
  autoCheckoutAfterMinutes!: number | null;

  @Column({
    default: ResourceStatus.ACTIVE,
    enum: ResourceStatus,
    enumName: 'resource_status',
    type: 'enum',
  })
  status!: ResourceStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => TenantEntity, (tenant) => tenant.attendancePolicies, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Relation<TenantEntity>;

  @OneToMany(() => EmployeeEntity, (employee) => employee.attendancePolicy)
  employees!: EmployeeEntity[];
}
